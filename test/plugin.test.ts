/**
 * `plugin.ts` against a fake host: what a fresh install, a hand-edited
 * settings file or a key cleared mid-session does to the user, and that every
 * failure ends as a notification that says what to change.
 */
import { describe, expect, it } from 'vitest';
import { BlockOps } from '../src/graph';
import { ChatMessage, ChatOptions, ChatResult } from '../src/deepseek';
import {
  COMMANDS_CHANGED,
  NO_API_KEY_AT_START,
  PluginHost,
  chatOptionsFor,
  responseItems,
  startPlugin,
} from '../src/plugin';
import { presetPrompts } from '../src/prompts';
import { PromptOutputType } from '../src/prompts/type';
import { NO_SEARCH_KEY_MESSAGE } from '../src/search';
import { readSettings } from '../src/settings';
import { getOutputParser } from '../src/parsers';

const BUILT_IN = presetPrompts.filter((p) => !p.requiresSearch).map((p) => p.name);

/** A block adapter that records what was written. `texts` answers successive `readText` calls. */
function fakeOps(opts: { context?: string; texts?: Array<string | null>; kept?: number } = {}) {
  const writes: string[] = [];
  const texts = [...(opts.texts ?? [])];
  const ops: BlockOps = {
    async readContext() {
      return opts.context ?? 'Hello';
    },
    async readText() {
      const next = texts.length > 1 ? texts.shift() : texts[0];
      return next === undefined ? 'Hello' : next;
    },
    async replaceText(_u, text, tag) {
      writes.push(`replace ${text}|${tag}`);
    },
    async appendText(_u, text, tag) {
      writes.push(`append ${text}|${tag}`);
    },
    async setProperty(_u, key, value, tag) {
      writes.push(`property ${key}=${value}|${tag}`);
    },
    async insertChild(_u, text) {
      writes.push(`insert ${text}`);
    },
    async rewriteSubtree(_u, outline, tag) {
      writes.push(`rewrite ${outline}|${tag}`);
      return opts.kept ?? 0;
    },
  };
  return { ops, writes };
}

type Chat = (messages: ChatMessage[], options: ChatOptions) => Promise<ChatResult>;

function answering(content: string, finishReason = 'stop'): { chat: Chat; seen: { messages: ChatMessage[]; options: ChatOptions }[] } {
  const seen: { messages: ChatMessage[]; options: ChatOptions }[] = [];
  return {
    seen,
    chat: async (messages, options) => {
      seen.push({ messages, options });
      return { content, finishReason };
    },
  };
}

function fakeHost(settings: unknown, opts: { ops?: BlockOps; chat?: Chat | null; verify?: PluginHost['verify'] } = {}) {
  const toasts: string[] = [];
  const open = new Set<string>();
  let n = 0;
  const commands = new Map<string, (uuid: string) => Promise<void>>();
  let onChange: (() => void) | undefined;
  let current = settings;
  const host: PluginHost = {
    settings: () => current,
    ops: async () => opts.ops ?? fakeOps().ops,
    ui: {
      async showMsg(message, status, o) {
        const key = `t${++n}`;
        toasts.push(`${status}: ${message}`);
        if (o?.timeout === 0) open.add(key);
        return key;
      },
      closeMsg(key) {
        open.delete(key);
      },
    },
    registerSlashCommand: (name, run) => {
      commands.set(name, run);
    },
    onSettingsChanged: (cb) => {
      onChange = cb;
    },
    // `null` means the real `chat`, which is what a fresh install runs.
    ...(opts.chat === null ? {} : { chat: opts.chat ?? (async () => { throw new Error('chat must not be called'); }) }),
    ...(opts.verify ? { verify: opts.verify } : {}),
    log: { debug: () => undefined, warn: () => undefined, error: () => undefined },
  };
  return {
    host,
    toasts,
    /** Sticky toasts still showing. */
    open,
    commands,
    run: (name: string, uuid = 'b1') => commands.get(name)!(uuid),
    change(next: unknown) {
      current = next;
      onChange?.();
    },
  };
}

const CONFIGURED = { apiKey: 'sk-x', basePath: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: '0.3', tag: '[[🤖]]' };

describe('a fresh install with nothing configured', () => {
  it('registers the twelve built-in commands, not /Verify Online, and says the key is missing', () => {
    const h = fakeHost({ disabled: false });
    startPlugin(h.host);
    expect([...h.commands.keys()]).toEqual(BUILT_IN);
    expect(h.toasts).toEqual([`warning: ${NO_API_KEY_AT_START}`]);
  });

  it('turns a command into "No DeepSeek API key configured", writes nothing and leaves no toast open', async () => {
    const { ops, writes } = fakeOps();
    const h = fakeHost({}, { ops, chat: null });
    startPlugin(h.host);
    await h.run('Summarize');
    expect(h.toasts.at(-1)).toBe('error: No DeepSeek API key configured. Set it in the plugin settings.');
    expect(writes).toEqual([]);
    expect(h.open.size).toBe(0);
  });

  it('is quiet at start once a key is set', () => {
    const h = fakeHost(CONFIGURED);
    startPlugin(h.host);
    expect(h.toasts).toEqual([]);
  });
});

describe('a settings file edited by hand', () => {
  it('does not stop the plugin from starting when a text field holds a number or null', () => {
    const h = fakeHost({ apiKey: 123, searchApiKey: 42, tag: null, basePath: undefined, model: 7 });
    expect(() => startPlugin(h.host)).not.toThrow();
    expect(h.commands.size).toBe(BUILT_IN.length);
  });

  it('reads such a file as unset rather than crashing a command', () => {
    expect(readSettings({ apiKey: 123, tag: null, temperature: '0.7', customPrompts: 'x' })).toEqual({
      apiKey: '', basePath: '', model: '', temperature: 0.7, searchApiKey: '', tag: '', customPrompts: 'x',
    });
    expect(readSettings(null).apiKey).toBe('');
  });

  it('reports a customPrompts of the wrong shape instead of silently doing nothing', () => {
    const h = fakeHost({ ...CONFIGURED, customPrompts: { enable: true, prompts: { name: 'X' } } });
    startPlugin(h.host);
    expect(h.toasts).toHaveLength(1);
    expect(h.toasts[0]).toMatch(/ignored 1 custom prompt/);
    expect(h.toasts[0]).toMatch(/"prompts" is not a list/);
  });
});

describe('the search key', () => {
  it('registers /Verify Online only when set', () => {
    const h = fakeHost({ ...CONFIGURED, searchApiKey: ' tvly-x ' });
    startPlugin(h.host);
    expect(h.commands.has('Verify Online')).toBe(true);
  });

  it('fails /Verify Online with the search-key message when cleared after registration, before any toast', async () => {
    const settings = { ...CONFIGURED, searchApiKey: 'tvly-x' };
    const h = fakeHost(settings);
    startPlugin(h.host);
    h.change({ ...CONFIGURED, searchApiKey: '' });
    await h.run('Verify Online');
    expect(h.toasts.at(-1)).toBe(`error: ${NO_SEARCH_KEY_MESSAGE}`);
    expect(h.open.size).toBe(0);
  });

  it('runs the verify loop with a search bound to the key', async () => {
    const { ops, writes } = fakeOps();
    const queries: string[] = [];
    const h = fakeHost({ ...CONFIGURED, searchApiKey: 'tvly-x' }, {
      ops,
      verify: async (_messages, _options, deps) => {
        queries.push('asked');
        expect(typeof deps.search).toBe('function');
        return { content: '✅ fine — https://x', queries };
      },
    });
    startPlugin(h.host);
    await h.run('Verify Online');
    expect(queries).toEqual(['asked']);
    expect(writes).toEqual(['insert ✅ fine — https://x #[[🤖]]']);
    expect(h.toasts.some((t) => t.startsWith('info: Verify Online… (searching)'))).toBe(true);
  });
});

describe('running a command', () => {
  it('refuses an empty block before calling the model', async () => {
    const { ops, writes } = fakeOps({ context: '  #[[🤖]] ' });
    const h = fakeHost(CONFIGURED, { ops });
    startPlugin(h.host);
    await h.run('Summarize');
    expect(h.toasts).toEqual(['warning: The block is empty — nothing to send to DeepSeek.']);
    expect(writes).toEqual([]);
  });

  it('refuses a rewrite of a block with no text of its own', async () => {
    const { ops, writes } = fakeOps({ context: 'Root\n\t- child', texts: ['#[[🤖]]'] });
    const h = fakeHost(CONFIGURED, { ops });
    startPlugin(h.host);
    await h.run('Polish');
    expect(h.toasts[0]).toMatch(/^warning: This block has no text of its own to rewrite/);
    expect(writes).toEqual([]);
  });

  it('sends the prompt with the settings applied and shows a sticky toast while waiting', async () => {
    const { ops, writes } = fakeOps();
    const a = answering('Short.');
    const h = fakeHost({ ...CONFIGURED, model: ' ', temperature: '1.3' }, { ops, chat: a.chat });
    startPlugin(h.host);
    await h.run('Summarize');
    expect(a.seen).toHaveLength(1);
    expect(a.seen[0].options).toEqual({ apiKey: 'sk-x', basePath: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: 1.3 });
    expect(a.seen[0].messages[1].content).toContain('Hello');
    expect(writes).toEqual(['property summarize=Short.| #[[🤖]]']);
    expect(h.toasts).toEqual(['info: Summarize…']);
    expect(h.open.size).toBe(0);
  });

  it('closes the waiting toast and shows the error when the model call fails', async () => {
    const h = fakeHost(CONFIGURED, { chat: async () => { throw new Error('Invalid DeepSeek API key (401): nope'); } });
    startPlugin(h.host);
    await h.run('Ask AI');
    expect(h.toasts).toEqual(['info: Ask AI…', 'error: Invalid DeepSeek API key (401): nope']);
    expect(h.open.size).toBe(0);
  });

  it('discards the answer when the block was deleted meanwhile', async () => {
    const { ops, writes } = fakeOps({ texts: [null] });
    const h = fakeHost(CONFIGURED, { ops, chat: answering('Answer').chat });
    startPlugin(h.host);
    await h.run('Ask AI');
    expect(h.toasts.at(-1)).toBe('warning: The block was deleted while DeepSeek was answering.');
    expect(writes).toEqual([]);
  });

  it('inserts one tagged child per list item and warns when there is none', async () => {
    const { ops, writes } = fakeOps();
    const h = fakeHost(CONFIGURED, { ops, chat: answering('- one\n- two').chat });
    startPlugin(h.host);
    await h.run('Brainstorm');
    expect(writes).toEqual(['insert one #[[🤖]]', 'insert two #[[🤖]]']);

    const none = fakeOps();
    const g = fakeHost(CONFIGURED, { ops: none.ops, chat: answering('❌ It is true. → ✅ It is true. (correct)').chat });
    startPlugin(g.host);
    await g.run('Fact Check');
    expect(none.writes).toEqual([]);
    expect(g.toasts.at(-1)).toBe('warning: DeepSeek returned nothing to insert.');
  });

  it('rewrites the subtree and reports blocks that had to be kept', async () => {
    const { ops, writes } = fakeOps({ kept: 2 });
    const h = fakeHost(CONFIGURED, { ops, chat: answering('Better\n\t- point').chat });
    startPlugin(h.host);
    await h.run('Polish');
    expect(writes).toEqual(['rewrite Better\n\t- point| #[[🤖]]']);
    expect(h.toasts.at(-1)).toMatch(/^warning: 2 block\(s\) were left as they were/);
  });

  it('warns when the answer was cut off, after writing it', async () => {
    const { ops, writes } = fakeOps();
    const h = fakeHost({ ...CONFIGURED, tag: '' }, { ops, chat: answering('Partial', 'length').chat });
    startPlugin(h.host);
    await h.run('Ask AI');
    expect(writes).toEqual(['insert Partial']);
    expect(h.toasts.at(-1)).toBe('warning: DeepSeek stopped at its output limit — the answer may be cut off.');
  });
});

describe('custom prompts', () => {
  const custom = (prompts: unknown[]) => ({ ...CONFIGURED, customPrompts: { enable: true, prompts } });

  it('apply edits at call time and keep the last definition of a removed one', async () => {
    const { ops, writes } = fakeOps();
    const a = answering('R');
    const h = fakeHost(custom([{ name: 'Mine', prompt: 'A {{text}}', output: 'append' }]), { ops, chat: a.chat });
    startPlugin(h.host);
    expect(h.commands.has('Mine')).toBe(true);

    h.change(custom([{ name: 'Mine', prompt: 'B {{text}}', output: 'insert', model: 'deepseek-reasoner' }]));
    await h.run('Mine');
    expect(a.seen[0].messages[1].content).toBe('B Hello');
    expect(a.seen[0].options.model).toBe('deepseek-reasoner');
    expect(writes).toEqual(['insert R #[[🤖]]']);

    h.change(custom([]));
    await h.run('Mine');
    expect(writes).toHaveLength(2);
  });

  it('a custom prompt with the name of a built-in one replaces it', async () => {
    const { ops, writes } = fakeOps();
    const h = fakeHost(custom([{ name: 'Summarize', prompt: 'S {{text}}', output: 'append' }]), { ops, chat: answering('S').chat });
    startPlugin(h.host);
    expect([...h.commands.keys()].filter((n) => n === 'Summarize')).toHaveLength(1);
    await h.run('Summarize');
    expect(writes).toEqual(['append S| #[[🤖]]']);
  });

  it('asks for a reload once when the set of commands changes, not on every later edit', () => {
    const h = fakeHost(CONFIGURED);
    startPlugin(h.host);
    h.change({ ...CONFIGURED, temperature: '0.5' });
    expect(h.toasts).toEqual([]);
    h.change(custom([{ name: 'New', prompt: 'p', output: 'insert' }]));
    h.change({ ...custom([{ name: 'New', prompt: 'p', output: 'insert' }]), temperature: '0.9' });
    expect(h.toasts).toEqual([`warning: ${COMMANDS_CHANGED}`]);
    h.change(custom([{ name: 'Newer', prompt: 'p', output: 'insert' }]));
    expect(h.toasts).toHaveLength(2);
    h.change(CONFIGURED);
    expect(h.toasts).toHaveLength(2);
  });

  it('reports problems when they appear and again only when they change', () => {
    const h = fakeHost(CONFIGURED);
    startPlugin(h.host);
    h.change(custom([{ name: 'Bad' }]));
    h.change({ ...custom([{ name: 'Bad' }]), temperature: '0.1' });
    expect(h.toasts.filter((t) => t.includes('ignored'))).toHaveLength(1);
    h.change(custom([{ name: 'Bad', prompt: 'p', output: 'nowhere' }]));
    expect(h.toasts.filter((t) => t.includes('ignored'))).toHaveLength(2);
    expect(h.toasts.at(-1)).toMatch(/invalid "output"/);
  });
});

describe('chatOptionsFor / responseItems', () => {
  it('fills the defaults and lets the prompt override the model', () => {
    const s = readSettings({});
    expect(chatOptionsFor(s, { name: 'x', prompt: 'p', output: PromptOutputType.insert })).toEqual({
      apiKey: '', basePath: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: undefined,
    });
    expect(chatOptionsFor(readSettings({ model: 'a' }), { name: 'x', prompt: 'p', output: PromptOutputType.insert, model: 'b' }).model).toBe('b');
  });

  it('splits a reply the way the output mode needs', () => {
    expect(responseItems(undefined, 'free\ntext')).toEqual(['free\ntext']);
    expect(responseItems(getOutputParser([]), '1. a\n\n- b')).toEqual(['a', 'b']);
    expect(responseItems(getOutputParser({ k: 'd', j: 'e' }), '{"k": "1", "j": ["x", "y"]}')).toEqual(['k: 1', 'j: x, y']);
  });
});
