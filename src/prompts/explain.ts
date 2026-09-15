import { SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

export const Explain: IPrompt = {
  name: 'Explain',
  system: `You are an expert teacher who explains complex topics in clear, understandable terms. ${SAME_LANGUAGE}`,
  prompt: `Please provide a clear explanation for the following text or code snippet:
"""
{content}
"""`,
  output: PromptOutputType.insert,
};
