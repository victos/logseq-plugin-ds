import { SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

/**
 * Deliberately `insert`, not `replace`: the model judges correctness from its
 * own knowledge and can be wrong, so it reports what it believes is false and
 * leaves the user's text alone. See the readme for the reasoning.
 */
export const FactCheck: IPrompt = {
  name: 'Fact Check',
  system:
    'You are a careful fact checker. You only flag statements that are objectively, ' +
    'verifiably false — never matters of opinion, style, taste or prediction. If you ' +
    'are not confident a statement is wrong, you stay silent about it. You never ' +
    `invent corrections. ${SAME_LANGUAGE}`,
  prompt: `Check the following text for factual errors:
"""
{content}
"""
Report only statements that are objectively false. Format each one as a single line:
❌ <the claim, quoted as written> → ✅ <the correction> (<one short reason>)
The ❌ and ✅ marks are required content, not list bullets — keep them.

A line is only for something that is FALSE. Never write a line about a statement that is correct — not to confirm it, not to say "no correction needed", not to mention it at all. Say nothing about the parts that are right.
Give every false claim its own line: if one sentence contains two false claims, that is two lines.
Do not report the same false claim twice.
Quote only the words that are false, not the whole passage around them.

If the text contains no factual errors, reply with one single line, in the language of the text, saying that no
factual errors were found — nothing else.`,
  output: PromptOutputType.insert,
  format: [],
};
