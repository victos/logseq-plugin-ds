import { describe, expect, it, vi } from 'vitest';
import { ChatMessage, ChatOptions, ChatResult } from '../src/deepseek';
import { SearchResult, SearchUnavailableError } from '../src/search';
import { ANSWER_NOW, MAX_SEARCH_HOPS, SEARCH_TOOL, verifyWithSearch } from '../src/verify';

const BASE: ChatOptions = {
  apiKey: 'k',
  basePath: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
};
const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'check this' }];

const hit = (url: string): SearchResult => ({
  answer: 'a summary',
  hits: [{ title: 'T', url, content: 'evidence' }],
});

const toolCall = (id: string, query: string, name = 'web_search') => ({
  id,
  type: 'function' as const,
  function: { name, arguments: JSON.stringify({ query }) },
});

/** A scripted model: returns the next canned result, recording what it saw. */
function scriptedChat(replies: ChatResult[]) {
  const seen: Array<{ messages: ChatMessage[]; tools?: unknown; toolChoice?: string }> = [];
  const chat = vi.fn(async (messages: ChatMessage[], options: ChatOptions) => {
    seen.push({ messages: [...messages], tools: options.tools, toolChoice: options.toolChoice });
    const next = replies.shift();
    if (!next) throw new Error('the model was asked more times than the script allows');
    return next;
  });
  return { chat: chat as unknown as typeof import('../src/deepseek').chat, seen };
}

describe('verifyWithSearch', () => {
  it('returns straight away when the model does not search', async () => {
    const { chat, seen } = scriptedChat([{ content: 'done' }]);
    const r = await verifyWithSearch(MESSAGES, BASE, { chat, search: async () => hit('u') });
    expect(r.content).toBe('done');
    expect(r.queries).toEqual([]);
    expect(seen[0].tools).toEqual([SEARCH_TOOL]);
    expect(seen[0].toolChoice).toBeUndefined();
  });

  it('runs the search and feeds the result back as a tool message', async () => {
    const { chat, seen } = scriptedChat([
      { content: '', toolCalls: [toolCall('c1', 'everest height')] },
      { content: 'verified' },
    ]);
    const search = vi.fn(async () => hit('https://e.com/everest'));
    const r = await verifyWithSearch(MESSAGES, BASE, { chat, search });

    expect(search).toHaveBeenCalledWith('everest height');
    expect(r.content).toBe('verified');
    expect(r.queries).toEqual(['everest height']);

    // Second turn must carry the assistant's tool_calls and the tool reply.
    const second = seen[1].messages;
    expect(second[1]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'c1' }] });
    expect(second[2]).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
    expect(second[2].content).toContain('https://e.com/everest');
  });

  it('serves several calls in one turn', async () => {
    const { chat } = scriptedChat([
      { content: '', toolCalls: [toolCall('a', 'one'), toolCall('b', 'two')] },
      { content: 'both checked' },
    ]);
    const r = await verifyWithSearch(MESSAGES, BASE, { chat, search: async () => hit('u') });
    expect(r.queries).toEqual(['one', 'two']);
  });

  // A failed search should not sink the command: the model can still say it
  // was unable to verify, which is a useful answer.
  it('hands a search failure to the model instead of throwing', async () => {
    const { chat, seen } = scriptedChat([
      { content: '', toolCalls: [toolCall('c1', 'q')] },
      { content: 'could not verify' },
    ]);
    const search = async () => {
      throw new Error('quota reached');
    };
    const r = await verifyWithSearch(MESSAGES, BASE, { chat, search });
    expect(r.content).toBe('could not verify');
    expect(seen[1].messages[2].content).toBe('Search failed: quota reached');
  });

  it('answers an unknown tool or an empty query without searching', async () => {
    const { chat, seen } = scriptedChat([
      { content: '', toolCalls: [toolCall('a', 'q', 'rm_rf'), toolCall('b', '   ')] },
      { content: 'ok' },
    ]);
    const search = vi.fn(async () => hit('u'));
    const r = await verifyWithSearch(MESSAGES, BASE, { chat, search });
    expect(search).not.toHaveBeenCalled();
    expect(r.queries).toEqual([]);
    expect(seen[1].messages[2].content).toBe('Unknown tool "rm_rf".');
    expect(seen[1].messages[3].content).toBe('No query given.');
  });

  // Seen live with deepseek-reasoner: given a history full of tool calls and a
  // request that no longer declares the tool, it answered with raw tool-call
  // markup as text. The definitions therefore stay; calling is forbidden instead.
  it('keeps the tool defined on the last pass but forbids calling it', async () => {
    const replies: ChatResult[] = Array.from({ length: MAX_SEARCH_HOPS }, (_, i) => ({
      content: '',
      toolCalls: [toolCall(`c${i}`, `q${i}`)],
    }));
    replies.push({ content: 'final' });
    const { chat, seen } = scriptedChat(replies);
    const r = await verifyWithSearch(MESSAGES, BASE, { chat, search: async () => hit('u') });
    expect(r.content).toBe('final');
    expect(seen).toHaveLength(MAX_SEARCH_HOPS + 1);
    expect(seen.slice(0, -1).every((s) => s.toolChoice === undefined)).toBe(true);
    expect(seen.slice(0, -1).some((s) => s.messages.some((m) => m.content === ANSWER_NOW))).toBe(false);
    const final = seen.at(-1)!;
    expect(final.tools).toEqual([SEARCH_TOOL]);
    expect(final.toolChoice).toBe('none');
    expect(final.messages.at(-1)).toEqual({ role: 'user', content: ANSWER_NOW });
  });

  // ANSWER_NOW goes to every searching command. A version that said "mark such
  // a claim with ❓" put ❓ into /Ask Online's prose on 3 forced answers out of 4;
  // /Verify Online's own prompt defines the mark and kept using it without help.
  it('the forced-answer line names no command\'s format', () => {
    expect(ANSWER_NOW).not.toMatch(/❓|✅|❌|fact check|claim/i);
    expect(ANSWER_NOW).toMatch(/Do not call any tool/);
    expect(ANSWER_NOW).toMatch(/format requested/);
  });

  // Seen live: refused a call, deepseek-reasoner wrote the call out as text.
  it('rejects an answer that is really leaked tool-call markup', async () => {
    const { chat } = scriptedChat([
      { content: '<｜DSML｜ calls>\n<｜DSML｜ invoke name="web_search">…' },
    ]);
    await expect(
      verifyWithSearch(MESSAGES, BASE, { chat, search: async () => hit('u') }),
    ).rejects.toThrow(/kept searching without answering/);
  });

  it('gives up if the model still asks for tools when forbidden, without serving them', async () => {
    const { chat } = scriptedChat([
      { content: '', toolCalls: [toolCall('a', 'q')] },
      { content: '', toolCalls: [toolCall('b', 'q2')] },
    ]);
    const search = vi.fn(async () => hit('u'));
    await expect(
      verifyWithSearch(MESSAGES, BASE, { chat, search, maxHops: 1 }),
    ).rejects.toThrow(/kept searching without answering \(1 rounds\)/);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('carries text the model wrote alongside its tool calls into the history', async () => {
    const { chat, seen } = scriptedChat([
      { content: 'Let me check.', toolCalls: [toolCall('c1', 'q')] },
      { content: 'checked' },
    ]);
    const r = await verifyWithSearch(MESSAGES, BASE, { chat, search: async () => hit('u') });
    expect(r.content).toBe('checked');
    expect(seen[1].messages[1]).toMatchObject({ role: 'assistant', content: 'Let me check.' });
  });

  // DeepSeek documents a 400 when a reasoning model's thinking is not passed
  // back in a tool loop, and a model that lost its reasoning is the one seen
  // writing tool-call markup as text.
  it('passes a reasoning model’s thinking back with its tool calls', async () => {
    const { chat, seen } = scriptedChat([
      { content: '', toolCalls: [toolCall('c1', 'q')], reasoningContent: 'let me look' },
      { content: '', toolCalls: [toolCall('c2', 'q2')] },
      { content: 'done' },
    ]);
    await verifyWithSearch(MESSAGES, BASE, { chat, search: async () => hit('u') });
    expect(seen[2].messages[1]).toMatchObject({ role: 'assistant', reasoning_content: 'let me look' });
    expect(seen[2].messages[3]).not.toHaveProperty('reasoning_content');
  });

  // Each search costs a credit, and the answer to the same query has not changed.
  it('answers a repeated query from the earlier result without searching again', async () => {
    const { chat, seen } = scriptedChat([
      { content: '', toolCalls: [toolCall('a', 'same query')] },
      { content: '', toolCalls: [toolCall('b', ' same query ')] },
      { content: 'done' },
    ]);
    const search = vi.fn(async () => hit('https://e.com/once'));
    const r = await verifyWithSearch(MESSAGES, BASE, { chat, search });
    expect(search).toHaveBeenCalledTimes(1);
    expect(r.queries).toEqual(['same query', 'same query']);
    expect(seen[2].messages[4].content).toBe(seen[2].messages[2].content);
  });

  // A bad key or a spent quota cannot be talked around: the user has to act,
  // and a page of ❓ would hide that from them.
  it('lets a search-unavailable error surface instead of feeding it to the model', async () => {
    const { chat } = scriptedChat([
      { content: '', toolCalls: [toolCall('c1', 'q')] },
      { content: 'never reached' },
    ]);
    const search = async () => {
      throw new SearchUnavailableError('Invalid Tavily API key (401): nope');
    };
    await expect(verifyWithSearch(MESSAGES, BASE, { chat, search })).rejects.toThrow(
      /Invalid Tavily API key \(401\)/,
    );
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('does not mutate the caller’s messages', async () => {
    const { chat } = scriptedChat([
      { content: '', toolCalls: [toolCall('c1', 'q')] },
      { content: 'done' },
    ]);
    const original: ChatMessage[] = [{ role: 'user', content: 'check this' }];
    await verifyWithSearch(original, BASE, { chat, search: async () => hit('u') });
    expect(original).toEqual([{ role: 'user', content: 'check this' }]);
  });
});
