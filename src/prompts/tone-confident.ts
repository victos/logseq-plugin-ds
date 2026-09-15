import { REWRITE_RULES, SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

export const ToneConfident: IPrompt = {
  name: 'Tone: Confident',
  system: `You are an expert in confident and assertive communication. ${SAME_LANGUAGE}`,
  prompt: `${REWRITE_RULES}

Please rewrite the following text with a confident tone.
Keep the original meaning and level of detail — do not add, remove or invent information:
"""
{content}
"""`,
  output: PromptOutputType.replace,
};
