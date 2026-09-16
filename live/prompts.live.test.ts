/// <reference types="node" />
/**
 * The behavioural suite for the prompts: the real prompts, the live DeepSeek
 * API (and Tavily for the searching commands), and properties of what comes
 * back. It costs money and needs keys, so it is not part of `pnpm test`; run
 * `pnpm test:live`. `docs/development.md` lists the knobs.
 *
 * Every cell — command × input kind × input language — is run several times,
 * because one run misled earlier rounds more than once. The counts are
 * written to `live/last-run.json` and compared with `live/baseline.json`, so
 * a prompt change shows up as "what moved", not only as pass or fail.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chat } from '../src/deepseek';
import { getOutputParser } from '../src/parsers';
import { buildMessages, chatOptionsFor, responseItems } from '../src/plugin';
import { resolvePrompts } from '../src/prompt';
import { presetPrompts } from '../src/prompts';
import { IPrompt } from '../src/prompts/type';
import { formatForModel, search } from '../src/search';
import { ISettings, readSettings } from '../src/settings';
import { verifyWithSearch } from '../src/verify';
import { CHECKS, Sample, Verdict } from './checks';
import { INPUTS, KINDS, Kind, LANGS, Lang, Property, propertiesFor } from './matrix';

const HERE = join(__dirname);
const BASELINE_PATH = join(HERE, 'baseline.json');
const LAST_RUN_JSON = join(HERE, 'last-run.json');
const LAST_RUN_TXT = join(HERE, 'last-run.txt');

// ---------------------------------------------------------------- settings

const env = process.env;

function loadSettings(): ISettings {
  const path = env.LIVE_SETTINGS ?? join(homedir(), '.logseq', 'settings', 'logseq-plugin-deepseek-assistant.json');
  const fromFile = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {};
  // The environment wins over the settings file, so CI can run without one.
  const settings = readSettings({
    ...fromFile,
    ...(env.DEEPSEEK_API_KEY ? { apiKey: env.DEEPSEEK_API_KEY } : {}),
    ...(env.DEEPSEEK_BASE_PATH ? { basePath: env.DEEPSEEK_BASE_PATH } : {}),
    ...(env.TAVILY_API_KEY ? { searchApiKey: env.TAVILY_API_KEY } : {}),
  });
  if (!settings.apiKey.trim()) {
    throw new Error(
      `No DeepSeek key: set DEEPSEEK_API_KEY or put "apiKey" in ${path} (LIVE_SETTINGS overrides the path).`,
    );
  }
  return settings;
}

type Scope = 'quick' | 'full';

interface Config {
  scope: Scope;
  /** Command names to run; undefined means the scope's list. */
  commands?: string[];
  kinds: Kind[];
  /** The kinds the searching commands run on — fewer than the rest in `quick`, each run costs several searches. */
  searchKinds: Kind[];
  langs: Lang[];
  samples: number;
  model?: string;
  minPass: number;
  concurrency: number;
  searchConcurrency: number;
  forced: boolean;
  includeSearch: boolean;
  writeBaseline: boolean;
}

const QUICK_COMMANDS = ['Ask AI', 'Summarize', 'Polish', 'Explain', 'Fact Check', 'Tone: Professional', 'Ask Online', 'Verify Online'];

function list<T extends string>(value: string | undefined, all: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const wanted = value.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  const picked = all.filter((item) => wanted.some((w) => item.toLowerCase().includes(w)));
  if (picked.length === 0) {
    throw new Error(`"${value}" matches none of: ${all.join(', ')}`);
  }
  return picked;
}

function loadConfig(): Config {
  const scope = (env.LIVE_SCOPE ?? 'quick') as Scope;
  if (scope !== 'quick' && scope !== 'full') {
    throw new Error(`LIVE_SCOPE must be quick or full, not "${scope}"`);
  }
  const quick = scope === 'quick';
  const kinds = list(env.LIVE_KINDS, KINDS) ?? (quick ? (['question', 'false-claim', 'outline'] as Kind[]) : KINDS);
  return {
    scope,
    commands: env.LIVE_COMMANDS?.split(',').map((v) => v.trim()).filter(Boolean) ?? (quick ? QUICK_COMMANDS : undefined),
    kinds,
    searchKinds: env.LIVE_KINDS ? kinds : quick ? (['question', 'false-claim'] as Kind[]) : KINDS,
    langs: list(env.LIVE_LANGS, LANGS) ?? LANGS,
    samples: Number(env.LIVE_SAMPLES ?? (quick ? 2 : 3)),
    model: env.LIVE_MODEL?.trim() || undefined,
    minPass: Number(env.LIVE_MIN_PASS ?? 0.6),
    concurrency: Number(env.LIVE_CONCURRENCY ?? 6),
    searchConcurrency: Number(env.LIVE_SEARCH_CONCURRENCY ?? 3),
    forced: env.LIVE_FORCED === '1',
    includeSearch: env.LIVE_SEARCH !== '0',
    writeBaseline: env.LIVE_BASELINE === 'write',
  };
}

// ---------------------------------------------------------------- the grid

interface Cell {
  id: string;
  label: string;
  command: IPrompt;
  kind: Kind;
  lang: Lang;
  /** Run with one search round only, so the forced-answer line (`ANSWER_NOW`) is what the model answers to. */
  forced: boolean;
  properties: Property[];
}

function commandsFor(settings: ISettings, cfg: Config): IPrompt[] {
  const hasKey = cfg.includeSearch && Boolean(settings.searchApiKey.trim());
  // The same resolution the plugin does, so custom prompts from the settings
  // file are in the grid too (with the generic properties only).
  const { prompts } = resolvePrompts(presetPrompts, settings.customPrompts, hasKey);
  if (!cfg.commands) return prompts;
  const picked = prompts.filter((p) => cfg.commands!.some((w) => p.name.toLowerCase().includes(w.toLowerCase())));
  return picked;
}

function buildCells(settings: ISettings, cfg: Config): Cell[] {
  const cells: Cell[] = [];
  for (const command of commandsFor(settings, cfg)) {
    const kinds = command.requiresSearch ? cfg.searchKinds : cfg.kinds;
    for (const kind of kinds) {
      for (const lang of cfg.langs) {
        cells.push({
          id: `${command.name}|${kind}|${lang}`,
          label: command.name,
          command,
          kind,
          lang,
          forced: false,
          properties: propertiesFor(command, kind),
        });
      }
    }
    if (cfg.forced && command.requiresSearch) {
      // One kind each: the forced path is about the last line, not the input.
      const kind: Kind = command.name === 'Verify Online' ? 'false-claim' : 'question';
      for (const lang of cfg.langs) {
        cells.push({
          id: `${command.name} (forced)|${kind}|${lang}`,
          label: `${command.name} (forced)`,
          command,
          kind,
          lang,
          forced: true,
          properties: propertiesFor(command, kind),
        });
      }
    }
  }
  return cells;
}

// ---------------------------------------------------------------- running

class Gate {
  private running = 0;
  private waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}

const TRANSIENT = /\(429\)|\(50[0-9]\)|temporarily unavailable|did not answer within|Could not reach|rate limit/i;

async function withRetry<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (!TRANSIENT.test((error as Error).message)) throw error;
    await new Promise((r) => setTimeout(r, 3000));
    return task();
  }
}

interface SampleRecord {
  raw: string;
  verdicts: Partial<Record<Property, Verdict>>;
  error?: string;
  /** Chat round trips and searches this sample cost. */
  calls: { chat: number; search: number };
}

interface CellRecord {
  n: number;
  errors: number;
  model: string;
  props: Partial<Record<Property, [pass: number, applicable: number]>>;
  samples: SampleRecord[];
}

const settings = loadSettings();
const cfg = loadConfig();
const cells = buildCells(settings, cfg);
const chatGate = new Gate(cfg.concurrency);
const searchGate = new Gate(cfg.searchConcurrency);
const results = new Map<string, CellRecord>();
const totals = { chat: 0, search: 0 };
const started = Date.now();

async function runSample(cell: Cell): Promise<SampleRecord> {
  const input = INPUTS[cell.kind][cell.lang];
  const messages = buildMessages(cell.command, input);
  const options = chatOptionsFor(settings, cell.command);
  if (cfg.model) options.model = cfg.model;
  const calls = { chat: 0, search: 0 };
  const served: string[] = [];
  const countedChat: typeof chat = async (m, o) => {
    calls.chat++;
    return chatGate.run(() => chat(m, o));
  };

  try {
    const result = cell.command.requiresSearch
      ? await searchGate.run(() =>
          withRetry(() =>
            verifyWithSearch(messages, options, {
              chat: countedChat,
              search: async (query) => {
                calls.search++;
                const found = await search(query, { apiKey: settings.searchApiKey.trim() });
                served.push(formatForModel(found));
                return found;
              },
              ...(cell.forced ? { maxHops: 1 } : {}),
            }),
          ),
        )
      : await withRetry(() => countedChat(messages, options));
    const raw = result.content;
    let items: string[];
    try {
      items = responseItems(getOutputParser(cell.command.format), raw);
    } catch {
      items = []; // a JSON format the model did not honour: `clean` fails on it
    }
    const sample: Sample = { raw, items, served };
    const context = { kind: cell.kind, lang: cell.lang, input };
    const verdicts: Partial<Record<Property, Verdict>> = {};
    for (const property of cell.properties) {
      verdicts[property] = CHECKS[property](sample, context);
    }
    return { raw, verdicts, calls };
  } catch (error) {
    return { raw: '', verdicts: {}, error: (error as Error).message, calls };
  } finally {
    totals.chat += calls.chat;
    totals.search += calls.search;
  }
}

function tally(cell: Cell, samples: SampleRecord[]): CellRecord {
  const props: CellRecord['props'] = {};
  for (const property of cell.properties) {
    let pass = 0;
    let applicable = 0;
    for (const sample of samples) {
      const verdict = sample.verdicts[property];
      if (verdict === 'pass' || verdict === 'fail') applicable++;
      if (verdict === 'pass') pass++;
    }
    props[property] = [pass, applicable];
  }
  return {
    n: samples.length,
    errors: samples.filter((s) => s.error).length,
    model: cfg.model ?? chatOptionsFor(settings, cell.command).model,
    props,
    samples,
  };
}

function excerpt(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

describe(`live prompts (${cfg.scope}: ${cells.length} cells × ${cfg.samples})`, () => {
  if (cells.length === 0) {
    it('has cells to run', () => {
      throw new Error('The filters selected no cell. Check LIVE_COMMANDS / LIVE_KINDS / LIVE_LANGS.');
    });
  }
  for (const cell of cells) {
    it.concurrent(cell.id, async () => {
      const samples = await Promise.all(Array.from({ length: cfg.samples }, () => runSample(cell)));
      const record = tally(cell, samples);
      results.set(cell.id, record);

      const problems: string[] = [];
      if (record.errors === record.n) {
        problems.push(`every sample errored: ${samples[0].error}`);
      }
      for (const [property, [pass, applicable]] of Object.entries(record.props)) {
        if (applicable > 0 && pass / applicable < cfg.minPass) {
          const failing = samples.find((s) => s.verdicts[property as Property] === 'fail');
          problems.push(`${property} ${pass}/${applicable} — e.g. ${JSON.stringify(excerpt(failing?.raw ?? ''))}`);
        }
      }
      expect(problems, `${cell.id}\n  ${problems.join('\n  ')}`).toEqual([]);
    });
  }

  afterAll(() => {
    if (results.size === 0) return;
    const report = buildReport();
    writeFileSync(LAST_RUN_JSON, JSON.stringify(report.json, null, 2));
    writeFileSync(LAST_RUN_TXT, report.text);
    if (cfg.writeBaseline) {
      writeFileSync(BASELINE_PATH, JSON.stringify(report.baseline, null, 2));
    }
    console.log(`\n${report.text}`);
  });
});

// ---------------------------------------------------------------- reporting

interface BaselineCell {
  n: number;
  model: string;
  props: Partial<Record<Property, [number, number]>>;
}
interface Baseline {
  recorded: string;
  cells: Record<string, BaselineCell>;
}

function readBaseline(): Baseline | undefined {
  if (!existsSync(BASELINE_PATH)) return undefined;
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
}

const rate = ([pass, applicable]: [number, number]) => (applicable === 0 ? 1 : pass / applicable);
const show = ([pass, applicable]: [number, number]) => (applicable === 0 ? 'n/a' : `${pass}/${applicable}`);

function buildReport() {
  const baseline = readBaseline();
  const ids = [...results.keys()].sort();
  const lines: string[] = [];
  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  const models = new Set([...results.values()].map((r) => r.model));

  lines.push(`Live prompt suite — ${cfg.scope}, ${ids.length} cells × ${cfg.samples} samples, model ${[...models].join('/')}`);
  lines.push(`${totals.chat} chat calls, ${totals.search} searches, ${minutes} min. Threshold: a property fails its cell below ${cfg.minPass * 100}% passes.`);
  lines.push('');

  let failingCells = 0;
  let propsPass = 0;
  let propsApplicable = 0;
  const width = Math.max(...ids.map((id) => id.length));
  for (const id of ids) {
    const record = results.get(id)!;
    const parts: string[] = [];
    let cellFails = false;
    for (const [property, count] of Object.entries(record.props) as [Property, [number, number]][]) {
      propsPass += count[0];
      propsApplicable += count[1];
      const bad = count[1] > 0 && rate(count) < cfg.minPass;
      cellFails ||= bad;
      parts.push(`${property} ${show(count)}${bad ? ' !' : ''}`);
    }
    if (record.errors > 0) {
      parts.push(`errors ${record.errors}`);
      cellFails ||= record.errors === record.n;
    }
    if (cellFails) failingCells++;
    lines.push(`${cellFails ? 'FAIL ' : 'ok   '}${id.padEnd(width)}  ${parts.join('  ')}`);
  }
  lines.push('');
  lines.push(`${ids.length - failingCells}/${ids.length} cells above threshold; ${propsPass}/${propsApplicable} property checks passed.`);

  // Failing replies, so the reader sees what the model actually said.
  const failures: string[] = [];
  for (const id of ids) {
    const record = results.get(id)!;
    for (const [property, count] of Object.entries(record.props) as [Property, [number, number]][]) {
      if (count[1] === 0 || count[0] === count[1]) continue;
      const failing = record.samples.filter((s) => s.verdicts[property] === 'fail');
      failures.push(`- ${id} · ${property} ${show(count)}: ${failing.map((s) => JSON.stringify(excerpt(s.raw))).join(' | ')}`);
    }
    for (const sample of record.samples.filter((s) => s.error)) {
      failures.push(`- ${id} · error: ${sample.error}`);
    }
  }
  if (failures.length > 0) {
    lines.push('', 'Samples that failed a property:', ...failures);
  }

  // The comparison. Rates are compared, so a baseline of 3 and a run of 5
  // still line up; a cell the baseline does not have is listed as new.
  lines.push('');
  if (!baseline) {
    lines.push(`No live/baseline.json yet. Record one with LIVE_BASELINE=write.`);
  } else {
    const down: string[] = [];
    const up: string[] = [];
    let same = 0;
    let fresh = 0;
    let otherModel = 0;
    for (const id of ids) {
      const record = results.get(id)!;
      const base = baseline.cells[id];
      if (!base) {
        fresh++;
        continue;
      }
      if (base.model !== record.model) {
        otherModel++;
        continue;
      }
      for (const [property, count] of Object.entries(record.props) as [Property, [number, number]][]) {
        const before = base.props[property];
        if (!before || before[1] === 0 || count[1] === 0) {
          continue;
        }
        const delta = rate(count) - rate(before);
        if (Math.abs(delta) < 1e-9) {
          same++;
        } else {
          const failing = record.samples.find((s) => s.verdicts[property] === 'fail');
          const line = `- ${id} · ${property}: ${show(before)} → ${show(count)}` +
            (delta < 0 && failing ? `  e.g. ${JSON.stringify(excerpt(failing.raw, 160))}` : '');
          (delta < 0 ? down : up).push(line);
        }
      }
    }
    lines.push(`Against live/baseline.json (recorded ${baseline.recorded}): ${down.length} down, ${up.length} up, ${same} unchanged` +
      (fresh ? `, ${fresh} cells new` : '') + (otherModel ? `, ${otherModel} cells skipped (other model)` : '') + '.');
    if (down.length) lines.push('', 'Down:', ...down);
    if (up.length) lines.push('', 'Up:', ...up);
  }
  if (cfg.writeBaseline) {
    lines.push('', 'Baseline written to live/baseline.json (cells from this run replace the old ones; others are kept).');
  }

  const json = {
    recorded: new Date().toISOString(),
    scope: cfg.scope,
    samples: cfg.samples,
    calls: totals,
    cells: Object.fromEntries(ids.map((id) => [id, results.get(id)!])),
  };
  const baselineCells: Record<string, BaselineCell> = { ...(baseline?.cells ?? {}) };
  for (const id of ids) {
    const { n, errors, model, props } = results.get(id)!;
    // A cell whose every sample errored (quota gone, network down) says nothing
    // about the prompt; it must not overwrite what an earlier run recorded.
    if (errors === n) continue;
    baselineCells[id] = { n, model, props };
  }
  const nextBaseline: Baseline = {
    recorded: new Date().toISOString().slice(0, 10),
    cells: Object.fromEntries(Object.entries(baselineCells).sort(([a], [b]) => a.localeCompare(b))),
  };
  return { text: lines.join('\n'), json, baseline: nextBaseline };
}
