/**
 * The properties a reply is checked for. Each is a predicate over one sample,
 * answering pass, fail, or n/a when the sample gives it nothing to judge (a
 * reply too short to carry a language, say). Heuristics throughout: the aim
 * is to catch a prompt that has drifted, not to grade prose.
 */
import { parseOutline } from '../src/outline';
import { ANSWER, FALSE_CLAIM, Kind, Lang, Property, TRUE_CLAIM } from './matrix';

export type Verdict = 'pass' | 'fail' | 'na';

export interface Sample {
  /** The model's reply as `chat()` returned it. */
  raw: string;
  /** The reply as the output mode sees it: after the list/JSON parser, or `[raw]`. */
  items: string[];
  /** Everything the search tool returned to the model during this run. */
  served: string[];
}

export interface CellContext {
  kind: Kind;
  lang: Lang;
  input: string;
}

const URL = /https?:\/\/[^\s<>()[\]"'）】，。；]+/g;
const MARK = /[❓✅❌]/g;
// `test()` on a /g regex is stateful; this one is for testing, MARK for stripping.
const HAS_MARK = /[❓✅❌]/;
const FENCED = /```[\s\S]*?```/g;

// Words that are common in one language and (as spelled) absent from the
// other. Overlaps such as "in", "an", "was" and "die" are left out on purpose.
const EN = new Set(('the and is are of to that with for it this on be as not were you your from by or can has have but ' +
  'which there their no found does do if at its into than more what when where who will would should about').split(' '));
const DE = new Set(('der die das und ist nicht ein eine einen einem einer mit für auf sich wird werden sind auch dass ich ' +
  'es zu von den dem im aber oder wenn wie noch nur bei nach aus über kann können hat haben sein sehr diese dieser dieses ' +
  'keine kein gefunden wurde wurden als um durch sie wir ihr dies sondern').split(' '));

/** The reply's prose: no URLs, marks or code, which carry no language. */
export function prose(raw: string): string {
  return raw.replace(FENCED, ' ').replace(URL, ' ').replace(MARK, ' ');
}

export function detectLanguage(text: string): Lang | 'unknown' {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) {
    return 'unknown';
  }
  const han = letters.filter((c) => /\p{Script=Han}/u.test(c)).length;
  if (han / letters.length >= 0.3) {
    return 'zh';
  }
  let en = 0;
  let de = 0;
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (EN.has(word)) en++;
    if (DE.has(word)) de++;
  }
  if (en === 0 && de === 0) return 'unknown';
  if (en === de) return 'unknown';
  return en > de ? 'en' : 'de';
}

export function urlsIn(text: string): string[] {
  return (text.match(URL) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ''));
}

const PREAMBLE = /^\s*(?:here(?:'s| is| are)\b|sure\b|certainly\b|of course\b|below is\b|以下是|好的[，,]|当然|hier ist\b|hier sind\b|natürlich\b|gerne\b|selbstverständlich\b)/i;
const QUOTED = /^\s*(?:"[\s\S]*"|“[\s\S]*”|「[\s\S]*」|«[\s\S]*»)\s*$/;

const bool = (ok: boolean): Verdict => (ok ? 'pass' : 'fail');
const finding = (item: string) => /^\s*❌/.test(item);

export const CHECKS: Record<Property, (s: Sample, c: CellContext) => Verdict> = {
  language(s, c) {
    const got = detectLanguage(prose(s.raw));
    return got === 'unknown' ? 'na' : bool(got === c.lang);
  },
  clean(s) {
    if (!s.raw.trim() || s.items.length === 0) return 'fail';
    // Code is looked past: a Python docstring is a legitimate `"""`.
    const outsideCode = s.raw.replace(FENCED, ' ');
    return bool(!/<｜+DSML｜+|<tool_call>|<function_calls?>|\{content\}|\{\{text\}\}|"""/.test(outsideCode));
  },
  'no-preamble'(s, c) {
    const first = s.raw.split('\n')[0].trim();
    // A reply that opens with the text's own first line has not added a preamble,
    // whatever that line happens to say ("好的，记下了。" is the input, not "Sure,").
    if (first === c.input.split('\n')[0].trim()) return bool(!QUOTED.test(s.raw));
    return bool(!PREAMBLE.test(first) && !QUOTED.test(s.raw));
  },
  'no-answer'(s) {
    return bool(!ANSWER.test(s.raw));
  },
  answers(s) {
    return bool(ANSWER.test(s.raw));
  },
  'outline-shape'(s) {
    // The plugin's own parser, with the option `rewriteSubtree` uses for a
    // reply that does not itself begin with a fence.
    const root = parseOutline(s.raw, { unwrapFence: true });
    return bool(Boolean(root) && root!.text.length > 0 && root!.children.length >= 1);
  },
  'keeps-code'(s) {
    return bool(/```/.test(s.raw));
  },
  'no-bloat'(s, c) {
    return bool(s.raw.trim().length <= Math.max(60, c.input.length * 4));
  },
  'one-line'(s) {
    return bool(s.items.length === 1 && !s.items[0].includes('\n'));
  },
  shorter(s, c) {
    return bool(s.raw.trim().length < c.input.length);
  },
  list(s) {
    return bool(s.items.length >= 2);
  },
  'flags-false'(s) {
    return bool(s.items.some((item) => finding(item) && FALSE_CLAIM.test(item)));
  },
  'no-false-positive'(s, c) {
    if (c.kind === 'false-claim') {
      // A ❌ that quotes the true claim without the false one is a false positive.
      return bool(!s.items.some((item) => finding(item) && TRUE_CLAIM.test(item) && !FALSE_CLAIM.test(item)));
    }
    return bool(!s.items.some(finding));
  },
  format(s) {
    const findings = s.items.filter(finding);
    return bool(findings.length > 0 && findings.every((item) => /^\s*❌\s*.+→\s*✅\s*.+/.test(item)));
  },
  'nothing-to-verify'(s) {
    return bool(s.items.length === 1 && !HAS_MARK.test(s.items[0]) && urlsIn(s.items[0]).length === 0);
  },
  confirms(s) {
    return bool(s.items.some((item) => /^\s*✅/.test(item)) && !s.items.some(finding));
  },
  sourced(s) {
    const verdicts = s.items.filter((item) => /^\s*[✅❌]/.test(item));
    if (verdicts.length > 0) {
      return bool(verdicts.every((item) => urlsIn(item).length > 0));
    }
    return bool(urlsIn(s.raw).length > 0);
  },
  'real-urls'(s) {
    const cited = urlsIn(s.raw);
    if (cited.length === 0) return 'na';
    const served = s.served.join('\n');
    return bool(cited.every((url) => served.includes(url)));
  },
  'no-marks'(s) {
    return bool(!HAS_MARK.test(s.raw));
  },
  'no-echo'(s, c) {
    return bool(!s.raw.includes(c.input.trim()));
  },
};
