import { SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

/**
 * The last paragraph is there because a Chinese or German block that is a
 * question or a to-do list came back as an English language lesson ("The text
 * you provided is a question written in German… Was = What, ist = is"), 0 runs
 * in 2 in the block's language for both languages and both kinds; with it,
 * 4 in 4 (live suite, deepseek-chat). English input was never affected.
 */
export const Explain: IPrompt = {
  name: 'Explain',
  system: `You are an expert teacher who explains complex topics in clear, understandable terms. ${SAME_LANGUAGE}`,
  prompt: `Please provide a clear explanation for the following text or code snippet:
"""
{content}
"""
Explain what the text says or what the code does. Do not describe which language the text is written in, do not translate it and do not explain its words or grammar — write the explanation in that same language, as a reader of the text would expect.`,
  output: PromptOutputType.insert,
};
