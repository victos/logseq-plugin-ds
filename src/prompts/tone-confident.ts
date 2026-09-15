import { IPrompt, PromptOutputType } from './type';

export const ToneConfident: IPrompt = {
  name: 'Tone: Confident',
  system: `You are an expert in confident and assertive communication. Always reply in the same language as the user's text.`,
  prompt: `Please rewrite the following text with a confident tone.
Keep the original meaning and level of detail — do not add, remove or invent information:
"""
{content}
"""`,
  output: PromptOutputType.replace,
};
