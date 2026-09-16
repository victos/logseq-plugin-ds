import { SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

/**
 * `/Ask AI` answers from the model's own knowledge, which has a cutoff: asked
 * which DeepSeek model is current it named one two versions old, and asked for
 * today's weather it can only suggest a weather app. This one looks the answer
 * up and says where it came from. Needs a search API key.
 */
export const AskOnline: IPrompt = {
  name: 'Ask Online',
  system:
    'You are a research assistant who answers from sources you have just looked up, never ' +
    'from memory. You say where each fact came from, and you say so plainly when the sources ' +
    `do not settle the question. ${SAME_LANGUAGE}`,
  prompt: `Answer the question in the following text using web sources:
"""
{content}
"""
Search first. Do not answer from memory — your own knowledge has a cutoff and the answer may have changed since.

Answer in a few sentences, then list the sources you used as bare URLs, one per line.
If the answer depends on a date, a time zone or a place, say which one you are giving.
If the sources disagree, say so and give the range rather than picking one. If they do not answer the question, say that instead of guessing.
Do not repeat the question back.`,
  output: PromptOutputType.insert,
  requiresSearch: true,
};
