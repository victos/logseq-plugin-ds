import { describe, expect, it } from 'vitest';
import { buildRequestBody } from '../src/deepseek';
import settings, { SETTING_DEFAULTS, readTemperature } from '../src/settings';

describe('readTemperature', () => {
  // Logseq's settings panel stores a number field as a string once it has been
  // edited ("temperature": "0.3" in the settings file); the client dropped it
  // and every command ran at DeepSeek's default of 1.0.
  it('accepts the string Logseq stores as well as a number', () => {
    expect(readTemperature(0.3)).toBe(0.3);
    expect(readTemperature('0.3')).toBe(0.3);
    expect(readTemperature(' 1.3 ')).toBe(1.3);
    expect(readTemperature(0)).toBe(0);
  });

  it('treats blank or missing as not set, and junk as something the client will drop', () => {
    expect(readTemperature('')).toBeUndefined();
    expect(readTemperature('  ')).toBeUndefined();
    expect(readTemperature(undefined)).toBeUndefined();
    expect(readTemperature(null)).toBeUndefined();
    expect(readTemperature('warm')).toBeNaN();
    expect(buildRequestBody([], 'deepseek-chat', readTemperature('warm'))).not.toHaveProperty('temperature');
    expect(buildRequestBody([], 'deepseek-chat', readTemperature('0.3'))).toHaveProperty('temperature', 0.3);
  });
});

describe('settings schema', () => {
  it('declares the documented defaults', () => {
    const byKey = Object.fromEntries(settings.map((s) => [s.key, s.default]));
    expect(byKey).toEqual({
      apiKey: '',
      basePath: SETTING_DEFAULTS.basePath,
      model: SETTING_DEFAULTS.model,
      temperature: SETTING_DEFAULTS.temperature,
      searchApiKey: '',
      tag: SETTING_DEFAULTS.tag,
      customPrompts: { enable: false, prompts: [] },
    });
    expect(SETTING_DEFAULTS).toEqual({
      basePath: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      temperature: 0.3,
      tag: '[[🤖]]',
    });
  });
});
