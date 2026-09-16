import { SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

/**
 * Deliberately `insert`, not `replace`: the model judges correctness from its
 * own knowledge and can be wrong, so it reports what it believes is false and
 * leaves the user's text alone. See the readme for the reasoning.
 *
 * Measured with the live suite (`live/`, deepseek-chat, 3 runs per cell): the
 * approximation sentence took `3.14159` in a code block from ❌ 0/3 (German and
 * Chinese) to no finding 3/3, and "boils at 100 °C" in Chinese from ❌ 2/3 to
 * 0/3. The "no errors found" sentence was English on German input 0/3 with
 * "in the language of the text" alone; naming the instructions' language as
 * the one *not* to use holds German 3/3 and Chinese 3/3 on a question, 1/3 on
 * a Chinese statement — that cell is the remaining weak spot.
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
A rounded or approximate figure that is right at the precision given is not an error: "water boils at 100 °C at sea level" and "3.14159" in a line of code are correct, not false. Code is not a factual claim.
Give every false claim its own line: if one sentence contains two false claims, that is two lines.
Do not report the same false claim twice.
Quote only the words that are false, not the whole passage around them.

If the text contains no factual errors, reply with exactly one short sentence saying that no factual errors were found — nothing else. That sentence must be written in the language of the text itself, whatever language that is, not in the language of these instructions.`,
  output: PromptOutputType.insert,
  format: [],
};
