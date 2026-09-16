import { describe, expect, it } from 'vitest';
import { buildUserMessage, resolvePrompts, validateCustomPrompt } from '../src/prompt';
import { presetPrompts } from '../src/prompts';
import { SAME_LANGUAGE } from '../src/prompts/shared';
import { IPrompt, PromptOutputType } from '../src/prompts/type';

const PRESETS = presetPrompts;

describe('buildUserMessage', () => {
  it('substitutes {{text}} and {content}', () => {
    expect(buildUserMessage('A {{text}} B', 'X')).toBe('A X B');
    expect(buildUserMessage('A {content} B', 'X')).toBe('A X B');
    expect(buildUserMessage('{{text}} and {content}', 'X')).toBe('X and X');
  });

  it('appends the text in triple quotes when there is no placeholder', () => {
    expect(buildUserMessage('Summarize:', 'X')).toBe('Summarize:\n"""\nX\n"""');
  });

  it('inserts block text verbatim even when it contains placeholders or $-patterns', () => {
    expect(buildUserMessage('Q: {{text}}', 'use {content} here')).toBe('Q: use {content} here');
    expect(buildUserMessage('Q: {content}', "echo $& $' $1 $$")).toBe("Q: echo $& $' $1 $$");
  });

  it('leaves other braces alone (Logseq macros, JSON examples)', () => {
    const prompt = 'Like {{query (todo)}} or {"a": 1}: {{text}}';
    expect(buildUserMessage(prompt, 'X')).toBe('Like {{query (todo)}} or {"a": 1}: X');
  });

  it('appends format instructions after a blank line', () => {
    expect(buildUserMessage('P {{text}}', 'X', 'One per line.')).toBe('P X\n\nOne per line.');
    expect(buildUserMessage('P {{text}}', 'X', undefined)).toBe('P X');
  });

  it('is stateless across calls despite using a global regex', () => {
    expect(buildUserMessage('{{text}}', 'a')).toBe('a');
    expect(buildUserMessage('{{text}}', 'b')).toBe('b');
    expect(buildUserMessage('none', 'c')).toBe('none\n"""\nc\n"""');
  });
});

describe('validateCustomPrompt', () => {
  it('accepts a minimal valid entry and normalises the output type', () => {
    expect(validateCustomPrompt({ name: ' X ', prompt: 'p', output: ' Replace ' }, 0)).toEqual({
      prompt: { name: 'X', prompt: 'p', output: PromptOutputType.replace },
    });
  });

  it('carries optional fields through', () => {
    const entry = { name: 'X', prompt: 'p', output: 'property', system: 's', model: 'm', format: [] };
    expect(validateCustomPrompt(entry, 0)).toEqual({
      prompt: { name: 'X', prompt: 'p', output: 'property', system: 's', model: 'm', format: [] },
    });
  });

  it.each([
    [null, 'not an object'],
    [['x'], 'not an object'],
    [{ prompt: 'p', output: 'replace' }, 'no "name"'],
    [{ name: '  ', prompt: 'p', output: 'replace' }, 'no "name"'],
    [{ name: 'X', output: 'replace' }, 'no "prompt"'],
    [{ name: 'X', prompt: 'p' }, 'invalid "output" (null)'],
    [{ name: 'X', prompt: 'p', output: 'child' }, 'invalid "output" ("child")'],
  ])('rejects %j', (entry, reason) => {
    const result = validateCustomPrompt(entry, 2);
    expect(result).toHaveProperty('problem');
    expect((result as { problem: string }).problem).toContain(reason);
  });
});

describe('resolvePrompts', () => {
  const custom = { name: 'Markdown Table', prompt: 't {{text}}', output: 'replace' };
  // Without a search key the search-gated commands are not offered at all.
  const OFFERED = PRESETS.filter((p) => !p.requiresSearch);

  it('returns only the presets when custom prompts are disabled or malformed', () => {
    expect(resolvePrompts(PRESETS, undefined).prompts).toEqual(OFFERED);
    expect(resolvePrompts(PRESETS, { enable: false, prompts: [custom] }).prompts).toEqual(OFFERED);
    expect(resolvePrompts(PRESETS, { enable: true, prompts: 'oops' }).prompts).toEqual(OFFERED);
  });

  it('appends valid custom prompts and reports invalid ones', () => {
    const { prompts, problems } = resolvePrompts(PRESETS, {
      enable: true,
      prompts: [custom, { name: 'Broken' }],
    });
    expect(prompts).toHaveLength(OFFERED.length + 1);
    expect(prompts.at(-1)).toMatchObject({ name: 'Markdown Table', output: 'replace' });
    expect(problems).toEqual(['"Broken" has no "prompt"']);
  });

  it('lets a custom prompt replace a built-in one with the same name, keeping its slot', () => {
    const override = { name: 'Summarize', prompt: 'custom', output: 'insert' };
    const { prompts } = resolvePrompts(PRESETS, { enable: true, prompts: [override] });
    expect(prompts).toHaveLength(OFFERED.length);
    expect(prompts.filter((p) => p.name === 'Summarize')).toEqual([
      { name: 'Summarize', prompt: 'custom', output: 'insert' },
    ]);
    expect(prompts.findIndex((p) => p.name === 'Summarize')).toBe(
      OFFERED.findIndex((p) => p.name === 'Summarize'),
    );
  });

  it('offers a search-gated command only once a key is configured', () => {
    const names = (searchAvailable: boolean) =>
      resolvePrompts(PRESETS, undefined, searchAvailable).prompts.map((p) => p.name);
    const gated = PRESETS.filter((p) => p.requiresSearch).map((p) => p.name);
    expect(gated).toEqual(['Ask Online', 'Verify Online']);
    for (const name of gated) {
      expect(names(false)).not.toContain(name);
      expect(names(true)).toContain(name);
    }
    expect(names(true).length).toBe(names(false).length + gated.length);
  });

  it('lets a custom prompt ask for web search', () => {
    const news = { name: 'News', prompt: 'latest on {{text}}', output: 'insert', search: true };
    const { prompts, problems } = resolvePrompts(PRESETS, { enable: true, prompts: [news] }, true);
    expect(problems).toEqual([]);
    expect(prompts.find((p) => p.name === 'News')).toMatchObject({ requiresSearch: true });
  });

  // The built-ins vanish quietly without a key; a command the user wrote would
  // just look broken, so it is reported instead.
  it('says why a searching custom prompt is missing when there is no key', () => {
    const news = { name: 'News', prompt: 'latest on {{text}}', output: 'insert', search: true };
    const { prompts, problems } = resolvePrompts(PRESETS, { enable: true, prompts: [news] }, false);
    expect(prompts.some((p) => p.name === 'News')).toBe(false);
    expect(problems).toEqual([
      '"News" asks for "search" but no Web Search API Key is set; add one in the settings or ' +
        'remove "search" from the prompt',
    ]);
  });

  it('rejects a non-boolean "search"', () => {
    const bad = { name: 'X', prompt: 'p {{text}}', output: 'insert', search: 'yes' };
    const { problems } = resolvePrompts(PRESETS, { enable: true, prompts: [bad] }, true);
    expect(problems).toEqual(['"X" has an invalid "search" ("yes"); it must be true or false']);
  });

  it('search: null is the same as leaving it out, like a null "format"', () => {
    const result = validateCustomPrompt({ name: 'X', prompt: 'p', output: 'insert', search: null }, 0);
    expect(result).toEqual({ prompt: { name: 'X', prompt: 'p', output: 'insert' } });
  });

  it('search: false is the same as leaving it out', () => {
    const off = { name: 'X', prompt: 'p {{text}}', output: 'insert', search: false };
    const { prompts, problems } = resolvePrompts(PRESETS, { enable: true, prompts: [off] }, false);
    expect(problems).toEqual([]);
    expect(prompts.find((p) => p.name === 'X')).toEqual({
      name: 'X',
      prompt: 'p {{text}}',
      output: 'insert',
    });
  });

  it('keeps the last of two custom prompts with the same name', () => {
    const { prompts } = resolvePrompts(PRESETS, {
      enable: true,
      prompts: [custom, { ...custom, prompt: 'second' }],
    });
    expect(prompts.filter((p) => p.name === 'Markdown Table')).toEqual([
      { name: 'Markdown Table', prompt: 'second', output: 'replace' },
    ]);
  });
});

describe('built-in prompts', () => {
  it('all have unique names, a {content} placeholder and a valid output type', () => {
    const names = PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const prompt of PRESETS) {
      expect(prompt.prompt).toContain('{content}');
      expect(Object.values(PromptOutputType)).toContain(prompt.output);
    }
  });

  it('all reply in the language of the source text', () => {
    for (const prompt of PRESETS) {
      expect(prompt.system).toContain(SAME_LANGUAGE);
    }
  });

  // Measured live on deepseek-chat. The earlier wording presumed the text was
  // not English ("these instructions are in English, but the text is not
  // necessarily … If the text is Chinese, reply in Chinese"), and the model
  // resolved that to Chinese: /Summarize on an English block 5/5 Chinese,
  // /Explain on a German block 5/5, /Ask Online on an English question 6/6.
  // Naming English as the first example swung /Tone: Professional on a Chinese
  // block to English 8/8. Neither presumption may come back.
  it('the language rule presumes nothing about which language the text is in', () => {
    expect(SAME_LANGUAGE).not.toMatch(/not necessarily/i);
    expect(SAME_LANGUAGE).not.toMatch(/if the text is chinese/i);
    expect(SAME_LANGUAGE).not.toMatch(/english text gets an english/i);
    expect(SAME_LANGUAGE).toMatch(/language the text is written in/i);
    expect(SAME_LANGUAGE).toMatch(/English included/);
  });

  // Rewrite commands must not let the model embellish: they replace the user's
  // own text, so invented detail would be silently written into their notes.
  it('in-place rewrites tell the model not to add or remove information', () => {
    const rewrites = PRESETS.filter(
      (p) => p.output === PromptOutputType.replace && p.name !== 'Shorten' && p.name !== 'Expand',
    );
    expect(rewrites.map((p) => p.name)).toEqual([
      'Polish',
      'Tone: Friendly',
      'Tone: Confident',
      'Tone: Casual',
      'Tone: Professional',
    ]);
    for (const prompt of rewrites) {
      expect(prompt.prompt).toMatch(/do not add, remove or invent information/i);
    }
  });

  // Fact Check judges correctness from the model's own knowledge, which can be
  // wrong. It must report, never overwrite what the user wrote.
  it('Fact Check reports instead of rewriting', () => {
    const factCheck = PRESETS.find((p) => p.name === 'Fact Check');
    expect(factCheck).toBeDefined();
    expect(factCheck!.output).toBe(PromptOutputType.insert);
    expect(factCheck!.format).toEqual([]);
    expect(factCheck!.prompt).toMatch(/no factual errors/i);
  });

  // Reported in use: every command answered the question in the block instead of
  // transforming it. The instruction alone was not enough — the model has to be
  // told the input is material, not a request.
  it('transform commands tell the model not to answer the text', () => {
    const transforms = PRESETS.filter(
      (p) => p.output === PromptOutputType.replace || p.name === 'Summarize',
    );
    expect(transforms.map((p) => p.name).sort()).toEqual([
      'Expand',
      'Polish',
      'Shorten',
      'Summarize',
      'Tone: Casual',
      'Tone: Confident',
      'Tone: Friendly',
      'Tone: Professional',
    ]);
    for (const prompt of transforms) {
      expect(prompt.prompt).toMatch(/not a request addressed to you/i);
      expect(prompt.prompt).toMatch(/never answer them/i);
    }
  });

  // Ask AI, Explain, Fact Check and Brainstorm are supposed to respond to the
  // content, so the guard must not leak onto them.
  it('response commands are left free to respond', () => {
    const responders = PRESETS.filter(
      (p) => p.output !== PromptOutputType.replace && p.name !== 'Summarize',
    );
    expect(responders.map((p) => p.name)).toEqual([
      'Ask AI',
      'Ask Online',
      'Explain',
      'Fact Check',
      'Verify Online',
      'Brainstorm',
    ]);
    for (const prompt of responders) {
      expect(prompt.prompt).not.toMatch(/not a request addressed to you/i);
    }
  });

  // Reported in use: a block that was only a question ("how's the weather
  // today?") came back with four invented "claims", all marked wrong even
  // where the sources agreed with them.
  it('Verify Online refuses to invent claims and keeps the verdicts apart', () => {
    const verify = PRESETS.find((p) => p.name === 'Verify Online');
    expect(verify).toBeDefined();
    expect(verify!.prompt).toMatch(/nothing to verify/i);
    expect(verify!.prompt).toMatch(/never invent a claim/i);
    expect(verify!.prompt).toMatch(/A question, a request, a heading.* is not a claim/i);
    // Seen live: a block of pure opinion came back as a ❓ line plus a "Note:" line.
    expect(verify!.prompt).toMatch(/an opinion or a prediction is not a claim/i);
    // The ✅/❌ split has to be stated, not just shown in the format list.
    expect(verify!.prompt).toMatch(/Use ✅ whenever the sources agree/i);
    expect(verify!.prompt).toMatch(/Use ❌ only when the sources contradict/i);
  });

  // /Ask AI answers from a knowledge cutoff: asked which DeepSeek model is
  // current it named one two versions old. /Ask Online must look it up instead.
  it('Ask Online searches rather than answering from memory, and cites sources', () => {
    const ask = PRESETS.find((p) => p.name === 'Ask Online');
    expect(ask).toBeDefined();
    expect(ask!.requiresSearch).toBe(true);
    expect(ask!.output).toBe(PromptOutputType.insert);
    expect(ask!.prompt).toMatch(/Do not answer from memory/i);
    expect(ask!.prompt).toMatch(/list the sources you used/i);
    expect(ask!.prompt).toMatch(/if the sources disagree/i);
  });

  // The registration list is written by hand, so a new prompt file that nobody
  // added to it would otherwise ship as a dead file. Load the files themselves
  // rather than what index.ts chose to re-export.
  it('the registered list covers every file in src/prompts/', () => {
    const modules = import.meta.glob<Record<string, unknown>>('../src/prompts/*.ts', { eager: true });
    const files = Object.keys(modules).filter((path) => !/\/(index|type|shared)\.ts$/.test(path));
    expect(files.length).toBeGreaterThan(0);

    const fromFiles = files
      .flatMap((path) => Object.values(modules[path]))
      .filter(
        (value): value is IPrompt =>
          typeof value === 'object' && value !== null && !Array.isArray(value) && 'name' in value,
      );
    expect(fromFiles).toHaveLength(files.length);
    expect(new Set(PRESETS)).toEqual(new Set(fromFiles));
    expect(PRESETS).toHaveLength(14);
  });
});

describe('a customPrompts setting of the wrong shape', () => {
  it('is reported when enabled with something other than a list of prompts', () => {
    expect(resolvePrompts(PRESETS, { enable: true, prompts: { name: 'X' } }).problems).toEqual([
      'customPrompts is enabled but "prompts" is not a list; it must be an object like {"enable": true, "prompts": [ … ]}',
    ]);
    expect(resolvePrompts(PRESETS, { enable: true }).problems[0]).toMatch(/"prompts" is missing/);
    expect(resolvePrompts(PRESETS, [{ name: 'X', prompt: 'p', output: 'insert' }]).problems[0]).toMatch(/is a list; it must be an object/);
    expect(resolvePrompts(PRESETS, 'yes').problems[0]).toMatch(/is "yes"; it must be an object/);
  });

  it('is left alone while disabled, and absent when unset', () => {
    expect(resolvePrompts(PRESETS, { enable: false, prompts: 'junk' }).problems).toEqual([]);
    expect(resolvePrompts(PRESETS, undefined).problems).toEqual([]);
    expect(resolvePrompts(PRESETS, null).problems).toEqual([]);
    expect(resolvePrompts(PRESETS, {}).problems).toEqual([]);
  });

  it('rejects a "format" that is neither a list nor an object', () => {
    expect(validateCustomPrompt({ name: 'X', prompt: 'p', output: 'insert', format: 'list' }, 0)).toEqual({
      problem: '"X" has an invalid "format" ("list"); expected [] for a list or {"key": "description"} for named fields',
    });
    expect(validateCustomPrompt({ name: 'X', prompt: 'p', output: 'insert', format: null }, 0)).toEqual({
      prompt: { name: 'X', prompt: 'p', output: 'insert' },
    });
  });
});
