import { IPrompt, PromptOutputType } from './type';

export const Summarize: IPrompt = {
  name: 'Summarize',
  system: `You are an expert at creating concise and accurate summaries. Always reply in the same language as the user's text.`,
  prompt: `Please provide a concise summary of the following text:
"""
{content}
"""`,
  output: PromptOutputType.property,
};
