import { IPrompt, PromptOutputType } from './type';

export const Explain: IPrompt = {
  name: 'Explain',
  system: `You are an expert teacher who explains complex topics in clear, understandable terms. Always reply in the same language as the user's text.`,
  prompt: `Please provide a clear explanation for the following text or code snippet:
"""
{content}
"""`,
  output: PromptOutputType.insert,
};
