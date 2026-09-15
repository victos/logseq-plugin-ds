import { describe, expect, it } from 'vitest';
import { buildUserMessage, resolvePrompts, validateCustomPrompt } from '../src/prompt';
import { presetPrompts } from '../src/prompts';
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

  it('returns only the presets when custom prompts are disabled or malformed', () => {
    expect(resolvePrompts(PRESETS, undefined).prompts).toEqual(PRESETS);
    expect(resolvePrompts(PRESETS, { enable: false, prompts: [custom] }).prompts).toEqual(PRESETS);
    expect(resolvePrompts(PRESETS, { enable: true, prompts: 'oops' }).prompts).toEqual(PRESETS);
  });

  it('appends valid custom prompts and reports invalid ones', () => {
    const { prompts, problems } = resolvePrompts(PRESETS, {
      enable: true,
      prompts: [custom, { name: 'Broken' }],
    });
    expect(prompts).toHaveLength(PRESETS.length + 1);
    expect(prompts.at(-1)).toMatchObject({ name: 'Markdown Table', output: 'replace' });
    expect(problems).toEqual(['"Broken" has no "prompt"']);
  });

  it('lets a custom prompt replace a built-in one with the same name, keeping its slot', () => {
    const override = { name: 'Summarize', prompt: 'custom', output: 'insert' };
    const { prompts } = resolvePrompts(PRESETS, { enable: true, prompts: [override] });
    expect(prompts).toHaveLength(PRESETS.length);
    expect(prompts.filter((p) => p.name === 'Summarize')).toEqual([
      { name: 'Summarize', prompt: 'custom', output: 'insert' },
    ]);
    expect(prompts.findIndex((p) => p.name === 'Summarize')).toBe(
      PRESETS.findIndex((p) => p.name === 'Summarize'),
    );
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
      expect(prompt.system).toMatch(/same language/i);
    }
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
    expect(responders.map((p) => p.name)).toEqual(['Ask AI', 'Explain', 'Fact Check', 'Brainstorm']);
    for (const prompt of responders) {
      expect(prompt.prompt).not.toMatch(/not a request addressed to you/i);
    }
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
    expect(PRESETS).toHaveLength(12);
  });
});
