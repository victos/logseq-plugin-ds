import { REWRITE_RULES, SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

export const ToneProfessional: IPrompt = {
  name: 'Tone: Professional',
  system: `You are an expert in professional business communication. ${SAME_LANGUAGE}`,
  prompt: `${REWRITE_RULES}

Please rewrite the following text with a professional tone.
Keep the original meaning and level of detail — do not add, remove or invent information:
"""
{content}
"""`,
  output: PromptOutputType.replace,
};
