import { SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

export const Brainstorm: IPrompt = {
  name: 'Brainstorm',
  system: `You are a creative AI assistant that generates innovative and relevant ideas. ${SAME_LANGUAGE}`,
  prompt: `Please generate creative ideas related to the following topic:
"""
{content}
"""`,
  output: PromptOutputType.insert,
  format: [],
};
