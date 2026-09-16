import { SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

/**
 * The counterpart to Fact Check: where that one judges from the model's own
 * knowledge, this one has to go and look, and every line it writes carries the
 * source it relied on. Needs a search API key, so it is only registered when
 * one is configured.
 *
 * The "nothing to verify" wording was measured with the live suite (`live/`,
 * 4 runs per cell, deepseek-chat). Without "in the language of the text" the
 * line was English on Chinese and German input 4/4; with it, English and
 * German hold 4/4 and Chinese 2-3/4. Two variants were worse: adding "not in
 * English unless the text is English" made the model explain itself over two
 * lines (Chinese question: one-line reply 4/4 → 1/4), and listing the sentence
 * as a fourth form next to ✅/❌/❓ made it write ❓ lines for questions and copy
 * the placeholder text literally. Opinions still get a ❓ line each in about
 * 1 run in 4 despite being named as not a claim.
 */
export const VerifyOnline: IPrompt = {
  name: 'Verify Online',
  system:
    'You are a fact checker who works from sources, never from memory. You search before ' +
    `you judge, and you never state a verdict you cannot attribute to a source. ${SAME_LANGUAGE}`,
  prompt: `Check the following text against web sources:
"""
{content}
"""
First decide what in the text is actually a factual claim — a statement that could be true or false. A question, a request, a heading, a note to yourself, a piece of code, an opinion, a preference or a prediction is not a claim, and gets no line of any kind — not even a ❓ line. If the text makes no factual claim, reply with exactly one short sentence, written in the language of the text, saying there is nothing to verify — no explanation, no second line — and stop. Never invent a claim the text does not make, and never restate the text's topic as if it were a claim.

For each claim the text really does make, search before judging. Do not answer from memory.

Write one line per claim, quoting the claim as the text words it, in one of these three forms:
✅ <the claim> — <url>
❌ <the claim> → <what the sources say instead> — <url>
❓ <the claim> — no reliable source found

Use ✅ whenever the sources agree with the claim. Use ❌ only when the sources contradict it — never for a claim the sources confirm, and never merely to add detail. Every ✅ and ❌ line must end with a real URL from the search results, never one you made up.`,
  output: PromptOutputType.insert,
  format: [],
  requiresSearch: true,
};
