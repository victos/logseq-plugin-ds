import { IPrompt, PromptOutputType } from './type';

export const ToneCasual: IPrompt = {
  name: 'Tone: Casual',
  system: `You are an expert in casual and conversational communication. Always reply in the same language as the user's text.`,
  prompt: `Please rewrite the following text with a casual tone.
Keep the original meaning and level of detail — do not add, remove or invent information:
"""
{content}
"""`,
  output: PromptOutputType.replace,
};
