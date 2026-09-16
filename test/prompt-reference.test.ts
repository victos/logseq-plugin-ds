/**
 * `docs/built-in-prompts.md` and its Chinese twin are generated from the
 * prompts themselves — a hand-kept copy of fourteen prompts would be wrong
 * within a week. This file both writes them (`pnpm docs:prompts`) and, on an
 * ordinary test run, fails if the committed copy has drifted, so regenerating
 * is not something anyone has to remember.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { describe as group, expect, it } from 'vitest';
import { presetPrompts } from '../src/prompts';
import { IPrompt } from '../src/prompts/type';

const LANGS = {
  en: {
    file: 'built-in-prompts.md',
    back: '[← readme](../readme.md)',
    title: 'The built-in prompts',
    intro: `Every command's prompt, exactly as it is sent. This file is generated from the code
by \`pnpm docs:prompts\` — edit the prompts, not this.

Copy one as the starting point for your own version: a [custom prompt](./custom-prompts.md)
whose \`name\` matches a built-in one replaces it, keeping its place in the slash menu. **Once you
do that, later fixes to that command stop reaching you** — the prompts here have been through
several rounds of measured correction, and your copy is frozen at the day you took it.`,
    fields: { output: 'Output', format: 'Format', model: 'Model', search: 'Needs a search key' },
    system: 'System',
    user: 'Prompt',
  },
  zh: {
    file: 'built-in-prompts.zh-CN.md',
    back: '[← readme](../readme.zh-CN.md)',
    title: '内置 prompt 全文',
    intro: `每条命令实际发送的 prompt 原文。本文件由 \`pnpm docs:prompts\` 从代码生成 —— 要改请改 prompt，别改这里。

想微调就把其中一条复制出去作为起点：[自定义命令](./custom-prompts.zh-CN.md)只要 \`name\` 和内置的
一致就会替换掉它，并保留它在斜杠菜单里的位置。**但一旦这么做，我们之后对那条命令的修复就不会再到达你** ——
这里的 prompt 经过了好几轮有实测依据的修正，而你的副本会停在复制它的那一天。`,
    fields: { output: '输出', format: '格式', model: '模型', search: '需要搜索 key' },
    system: 'System',
    user: 'Prompt',
  },
} as const;

interface Labels {
  output: string;
  format: string;
  model: string;
  search: string;
}

function describe(p: IPrompt, f: Labels): string[] {
  const rows = [`${f.output}: \`${p.output}\``];
  if (p.format !== undefined) rows.push(`${f.format}: \`${JSON.stringify(p.format)}\``);
  if (p.model) rows.push(`${f.model}: \`${p.model}\``);
  if (p.requiresSearch) rows.push(`${f.search}`);
  return rows;
}

function render(lang: (typeof LANGS)[keyof typeof LANGS]): string {
  const parts = [`# ${lang.title}`, '', lang.back, '', lang.intro, ''];
  for (const p of presetPrompts) {
    parts.push(`## /${p.name}`, '', describe(p, lang.fields).join(' · '), '');
    if (p.system) parts.push(`**${lang.system}**`, '', '```text', p.system, '```', '');
    parts.push(`**${lang.user}**`, '', '```text', p.prompt, '```', '');
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n');
}

const path = (file: string) => join(__dirname, '..', 'docs', file);

group('the built-in prompt reference', () => {
  for (const lang of Object.values(LANGS)) {
    it(`${lang.file} matches the prompts`, () => {
      const wanted = render(lang);
      if (process.env.WRITE_DOCS) {
        writeFileSync(path(lang.file), wanted);
        return;
      }
      const have = readFileSync(path(lang.file), 'utf8');
      expect(have, `${lang.file} is out of date — run \`pnpm docs:prompts\``).toBe(wanted);
    });
  }
});
