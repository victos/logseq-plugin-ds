import { REWRITE_RULES, SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

export const ToneFriendly: IPrompt = {
  name: 'Tone: Friendly',
  system: `You are an expert in warm and friendly communication. ${SAME_LANGUAGE}`,
  prompt: `${REWRITE_RULES}

Please rewrite the following text with a friendly tone.
Keep the original meaning and level of detail — do not add, remove or invent information:
"""
{content}
"""`,
  output: PromptOutputType.replace,
};
