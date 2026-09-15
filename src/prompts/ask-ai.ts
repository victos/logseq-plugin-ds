import { IPrompt, PromptOutputType } from './type';

export const AskAI: IPrompt = {
  name: 'Ask AI',
  system: `You are a helpful AI assistant that provides clear and concise answers. Always reply in the same language as the user's text.`,
  prompt: `I have a question:
"""
{content}
"""
Please provide a helpful answer.`,
  output: PromptOutputType.insert,
};
