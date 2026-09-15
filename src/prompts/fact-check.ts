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

If the text contains no factual errors, reply with one single line saying that no
factual errors were found — nothing else.`,
  output: PromptOutputType.insert,
  format: [],
};
