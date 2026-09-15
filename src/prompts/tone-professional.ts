import { IPrompt, PromptOutputType } from './type';

export const ToneProfessional: IPrompt = {
  name: 'Tone: Professional',
  system: `You are an expert in professional business communication. Always reply in the same language as the user's text.`,
  prompt: `Please rewrite the following text with a professional tone.
Keep the original meaning and level of detail — do not add, remove or invent information:
"""
{content}
"""`,
  output: PromptOutputType.replace,
};
