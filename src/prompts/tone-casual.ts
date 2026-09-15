import { REWRITE_RULES, SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

export const ToneCasual: IPrompt = {
  name: 'Tone: Casual',
  system: `You are an expert in casual and conversational communication. ${SAME_LANGUAGE}`,
  prompt: `${REWRITE_RULES}

Please rewrite the following text with a casual tone.
Keep the original meaning and level of detail — do not add, remove or invent information:
"""
{content}
"""`,
  output: PromptOutputType.replace,
};
