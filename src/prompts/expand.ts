import { IPrompt, PromptOutputType } from './type';

export const Expand: IPrompt = {
  name: 'Expand',
  system: `You are an expert at expanding and elaborating on ideas with relevant details. Always reply in the same language as the user's text.`,
  prompt: `Please expand the following text, providing more details and depth:
"""
{content}
"""`,
  output: PromptOutputType.replace,
};
