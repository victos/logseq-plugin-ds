import { SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

export const AskAI: IPrompt = {
  name: 'Ask AI',
  system: `You are a helpful AI assistant that provides clear and concise answers. ${SAME_LANGUAGE}`,
  prompt: `I have a question:
"""
{content}
"""
Please provide a helpful answer.`,
  output: PromptOutputType.insert,
};
