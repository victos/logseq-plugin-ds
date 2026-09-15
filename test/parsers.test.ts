import { describe, expect, it } from 'vitest';
import { getOutputParser, ListParser, StructuredParser } from '../src/parsers';

const list = () => getOutputParser([]) as ListParser;
const structured = (schema: Record<string, string>) => getOutputParser(schema) as StructuredParser;

describe('getOutputParser', () => {
  it('selects the list parser for any array', () => {
    expect(getOutputParser([])?.kind).toBe('list');
    expect(getOutputParser(['ignored'])?.kind).toBe('list');
  });

  it('selects the structured parser for a non-empty object', () => {
    expect(getOutputParser({ a: 'A' })?.kind).toBe('structured');
  });

  it('returns no parser for free text, an empty object, or junk', () => {
    expect(getOutputParser(undefined)).toBeUndefined();
    expect(getOutputParser(null)).toBeUndefined();
    expect(getOutputParser('list')).toBeUndefined();
    expect(getOutputParser({})).toBeUndefined();
    expect(getOutputParser(42)).toBeUndefined();
  });
});

describe('list parser', () => {
  it('asks for one item per line without bullets', () => {
    expect(list().formatInstructions).toMatch(/one item per line/i);
  });

  it('strips bullets and numbering, trims, and drops blank lines', () => {
    const text = '- one\n* two\n+ three\n• four\n1. five\n2) six\n\n   seven  \n';
    expect(list().parse(text)).toEqual(['one', 'two', 'three', 'four', 'five', 'six', 'seven']);
  });

  it('keeps inline markdown and text that merely starts with a dash-like character', () => {
    expect(list().parse('**Bold** idea\n-1 is negative\n-not a bullet')).toEqual([
      '**Bold** idea',
      '-1 is negative',
      '-not a bullet',
    ]);
  });

  it('returns an empty list for whitespace-only text', () => {
    expect(list().parse(' \n\n ')).toEqual([]);
  });
});

describe('structured parser', () => {
  const schema = { title: 'A short title', mood: 'One word' };

  it('tells the model the exact keys and descriptions as JSON', () => {
    const instructions = structured(schema).formatInstructions;
    expect(instructions).toContain('"title": "A short title"');
    expect(instructions).toContain('"mood": "One word"');
    expect(instructions).toMatch(/single JSON object/);
  });

  it('escapes quotes in descriptions so the example stays valid JSON', () => {
    const instructions = structured({ q: 'say "hi"' }).formatInstructions;
    expect(instructions).toContain('"q": "say \\"hi\\""');
  });

  it('parses a bare JSON object', () => {
    expect(structured(schema).parse('{"title": "T", "mood": "calm"}')).toEqual({
      title: 'T',
      mood: 'calm',
    });
  });

  it('parses an object inside a ```json fence or wrapped in prose', () => {
    const fenced = 'Sure!\n```json\n{"title": "T", "mood": "calm"}\n```\nDone.';
    expect(structured(schema).parse(fenced)).toEqual({ title: 'T', mood: 'calm' });
    const prose = 'Here you go: {"title": "T", "mood": "calm"} hope it helps';
    expect(structured(schema).parse(prose)).toEqual({ title: 'T', mood: 'calm' });
  });

  it('handles nested braces inside string values', () => {
    expect(structured(schema).parse('{"title": "a {b} c", "mood": "}"}')).toEqual({
      title: 'a {b} c',
      mood: '}',
    });
  });

  it('fills missing or null keys with an empty string and ignores extra keys', () => {
    expect(structured(schema).parse('{"title": null, "extra": 1}')).toEqual({ title: '', mood: '' });
  });

  it('renders non-string values sensibly', () => {
    const parsed = structured({ n: '', b: '', arr: '', obj: '' }).parse(
      '{"n": 3, "b": true, "arr": ["x", 2], "obj": {"k": "v"}}',
    );
    expect(parsed).toEqual({ n: '3', b: 'true', arr: 'x, 2', obj: '{"k":"v"}' });
  });

  it('rejects arrays, scalars and unparseable text with a snippet of the response', () => {
    expect(() => structured(schema).parse('["a"]')).toThrow(/Expected a JSON object/);
    expect(() => structured(schema).parse('42')).toThrow(/Expected a JSON object/);
    expect(() => structured(schema).parse('not json at all')).toThrow(/not json at all/);
    expect(() => structured(schema).parse('{"title": unquoted}')).toThrow(/Expected a JSON object/);
  });
});
