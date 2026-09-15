import { IPrompt, PromptOutputType } from './type';

export const Brainstorm: IPrompt = {
  name: 'Brainstorm',
  system: `You are a creative AI assistant that generates innovative and relevant ideas. Always reply in the same language as the user's text.`,
  prompt: `Please generate creative ideas related to the following topic:
"""
{content}
"""`,
  output: PromptOutputType.insert,
  format: [],
};
