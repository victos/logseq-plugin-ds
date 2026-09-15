import { describe, expect, it, vi } from 'vitest';
import { ChatMessage, ChatOptions, ChatResult } from '../src/deepseek';
import { SearchResult } from '../src/search';
import { MAX_SEARCH_HOPS, SEARCH_TOOL, verifyWithSearch } from '../src/verify';

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
  const seen: Array<{ messages: ChatMessage[]; tools?: unknown }> = [];
  const chat = vi.fn(async (messages: ChatMessage[], options: ChatOptions) => {
    seen.push({ messages: [...messages], tools: options.tools });
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

  it('withdraws the tool on the last pass so the model has to answer', async () => {
    const replies: ChatResult[] = Array.from({ length: MAX_SEARCH_HOPS }, (_, i) => ({
      content: '',
      toolCalls: [toolCall(`c${i}`, `q${i}`)],
    }));
    replies.push({ content: 'final' });
    const { chat, seen } = scriptedChat(replies);
    const r = await verifyWithSearch(MESSAGES, BASE, { chat, search: async () => hit('u') });
    expect(r.content).toBe('final');
    expect(seen).toHaveLength(MAX_SEARCH_HOPS + 1);
    expect(seen.at(-1)!.tools).toBeUndefined();
  });

  it('gives up if the model still only asks for tools with none offered', async () => {
    const { chat } = scriptedChat([
      { content: '', toolCalls: [toolCall('a', 'q')] },
      { content: '', toolCalls: [toolCall('b', 'q')] },
    ]);
    await expect(
      verifyWithSearch(MESSAGES, BASE, { chat, search: async () => hit('u'), maxHops: 1 }),
    ).rejects.toThrow(/kept searching without answering/);
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
