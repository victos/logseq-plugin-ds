import { IPrompt, PromptOutputType } from './type';

export const Shorten: IPrompt = {
  name: 'Shorten',
  system: `You are an expert at concise writing and summarization. Always reply in the same language as the user's text.`,
  prompt: `Please shorten the following text while maintaining its key points:
"""
{content}
"""`,
  output: PromptOutputType.replace,
};
