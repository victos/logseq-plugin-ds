/**
 * The grid the live prompt suite walks: every command × input language ×
 * input kind, and which properties of the reply are checked in each cell.
 *
 * The inputs are fixed on purpose. A property such as "does not answer the
 * question" needs to know what the answer would look like, so each kind
 * carries the same facts in all three languages and the tokens that would
 * betray a wrong reply are listed below the inputs.
 */
import { IPrompt } from '../src/prompts/type';

export type Lang = 'en' | 'zh' | 'de';
export const LANGS: Lang[] = ['en', 'zh', 'de'];

export type Kind =
  | 'question'
  | 'true-claim'
  | 'false-claim'
  | 'opinion'
  | 'outline'
  | 'code'
  | 'empty-ish';
export const KINDS: Kind[] = ['question', 'true-claim', 'false-claim', 'opinion', 'outline', 'code', 'empty-ish'];

/**
 * The block text as `readContext` hands it to a command: the block's own
 * line first, children as tab-indented `- ` lines (see `blockToText`).
 */
export const INPUTS: Record<Kind, Record<Lang, string>> = {
  question: {
    en: 'What is the capital of Portugal?',
    zh: '葡萄牙的首都是哪里？',
    de: 'Was ist die Hauptstadt von Portugal?',
  },
  'true-claim': {
    en: 'Canberra is the capital of Australia, and water boils at 100 °C at sea level.',
    zh: '堪培拉是澳大利亚的首都，水在海平面上 100 °C 沸腾。',
    de: 'Canberra ist die Hauptstadt Australiens, und Wasser kocht auf Meereshöhe bei 100 °C.',
  },
  // One true claim and one false one, so a fact checker has to tell them apart.
  'false-claim': {
    en: 'Canberra is the capital of Australia, and the Great Wall of China is visible to the naked eye from the Moon.',
    zh: '堪培拉是澳大利亚的首都，而且从月球上用肉眼就能看到中国的长城。',
    de: 'Canberra ist die Hauptstadt Australiens, und die Chinesische Mauer ist mit bloßem Auge vom Mond aus zu sehen.',
  },
  opinion: {
    en: 'Autumn is the most beautiful season, and tea is far better than coffee.',
    zh: '秋天是最美的季节，茶比咖啡好得多。',
    de: 'Der Herbst ist die schönste Jahreszeit, und Tee ist viel besser als Kaffee.',
  },
  // Long enough that a summary can be shorter than it and a rewrite has
  // sub-points to keep; a three-line outline was not.
  outline: {
    en: "Plan for the team offsite in October\n\t- Book the venue by Friday and confirm the room layout with them\n\t- Collect everyone's dietary requirements before the catering order goes in\n\t- Draft the agenda, share it with the team and collect comments for a week\n\t- Arrange transport for the people coming from the other office\n\t- Send the final schedule out two days before we leave",
    zh: '十月团队外出活动计划\n\t- 周五前订好场地，并和场地方确认房间布置\n\t- 在下餐饮订单之前收集好大家的饮食要求\n\t- 起草议程，发给全组，收集一周的意见\n\t- 给从另一个办公室过来的同事安排交通\n\t- 出发前两天把最终日程发出去',
    de: 'Plan für das Team-Offsite im Oktober\n\t- Bis Freitag den Veranstaltungsort buchen und die Raumaufteilung mit ihm abstimmen\n\t- Die Essenswünsche aller einsammeln, bevor die Catering-Bestellung rausgeht\n\t- Die Agenda entwerfen, mit dem Team teilen und eine Woche lang Rückmeldungen sammeln\n\t- Den Transport für die Kolleginnen und Kollegen aus dem anderen Büro organisieren\n\t- Den endgültigen Ablauf zwei Tage vor der Abfahrt verschicken',
  },
  // A one-line lead-in gives the language a foothold; the code itself has none.
  code: {
    en: 'A helper I wrote yesterday:\n```python\ndef area(r):\n    return 3.14159 * r * r\n```',
    zh: '我昨天写的一个小函数：\n```python\ndef area(r):\n    return 3.14159 * r * r\n```',
    de: 'Eine kleine Hilfsfunktion von gestern:\n```python\ndef area(r):\n    return 3.14159 * r * r\n```',
  },
  'empty-ish': {
    en: 'ok, noted.',
    zh: '好的，记下了。',
    de: 'Ok, notiert.',
  },
};

/** The answer to the question kind, in every language; a reply carrying it has answered. */
export const ANSWER = /lisbon|lissabon|lisboa|里斯本/i;
/** The claim that is true in both statement kinds. A ❌ about it is a false positive. */
export const TRUE_CLAIM = /canberra|堪培拉/i;
/** The claim that is false in the false-claim kind. */
export const FALSE_CLAIM = /great wall|长城|mauer|moon|月球|mond/i;

export type Property =
  | 'language' // the reply is in the language of the input
  | 'clean' // not empty; no leaked markup, placeholder or triple quote
  | 'no-preamble' // a rewrite starts with the text, not "Here is…"
  | 'no-answer' // a rewrite or summary of a question does not answer it
  | 'answers' // /Ask AI and /Ask Online do answer it
  | 'outline-shape' // a rewrite of an outline is still an outline the plugin can apply
  | 'keeps-code' // a rewrite of a block with a code fence still has one
  | 'no-bloat' // a rewrite of two words is not a paragraph
  | 'one-line' // a property value, or the single "nothing found" line
  | 'shorter' // a summary is shorter than its input
  | 'list' // /Brainstorm gives at least two items
  | 'flags-false' // /Fact Check and /Verify Online report the false claim
  | 'no-false-positive' // …and never report the true one, or anything when nothing is false
  | 'format' // /Fact Check findings are `❌ … → ✅ …`
  | 'nothing-to-verify' // /Verify Online on a non-claim: one line, no marks, no URL
  | 'confirms' // /Verify Online on true claims: ✅ and no ❌
  | 'sourced' // every verdict / answer carries a URL
  | 'real-urls' // every URL cited was in the search results
  | 'no-marks' // /Ask Online prose carries no ❓✅❌
  | 'no-echo'; // /Ask Online does not repeat the question

const REWRITES = new Set(['Polish', 'Shorten', 'Expand', 'Tone: Friendly', 'Tone: Confident', 'Tone: Casual', 'Tone: Professional']);

/** Which properties a cell asserts. A command the grid does not know (a custom prompt) gets the generic two. */
export function propertiesFor(command: IPrompt, kind: Kind): Property[] {
  const props: Property[] = ['language', 'clean'];
  const { name } = command;
  if (REWRITES.has(name)) {
    props.push('no-preamble');
    // /Expand on a question expands it with the answer, 4 runs out of 4. Adding
    // detail is that command's job, so this is documented rather than asserted.
    if (kind === 'question' && name !== 'Expand') props.push('no-answer');
    if (kind === 'outline') props.push('outline-shape');
    if (kind === 'code') props.push('keeps-code');
    if (kind === 'empty-ish' && name !== 'Expand') props.push('no-bloat');
    return props;
  }
  switch (name) {
    case 'Summarize':
      props.push('one-line');
      if (kind === 'question') props.push('no-answer');
      if (kind === 'outline') props.push('shorter');
      return props;
    case 'Ask AI':
      if (kind === 'question') props.push('answers');
      return props;
    case 'Brainstorm':
      props.push('list');
      return props;
    case 'Fact Check':
      props.push('no-false-positive');
      if (kind === 'false-claim') props.push('flags-false', 'format');
      else props.push('one-line');
      return props;
    case 'Verify Online':
      props.push('real-urls');
      if (kind === 'true-claim') props.push('confirms', 'sourced');
      else if (kind === 'false-claim') props.push('flags-false', 'no-false-positive', 'sourced');
      else props.push('nothing-to-verify');
      return props;
    case 'Ask Online':
      props.push('no-marks', 'real-urls');
      // A block with no question gets "there is no question here" and nothing to cite.
      if (kind === 'question' || kind === 'true-claim' || kind === 'false-claim') props.push('sourced');
      if (kind === 'question') props.push('answers', 'no-echo');
      return props;
    default:
      return props;
  }
}
