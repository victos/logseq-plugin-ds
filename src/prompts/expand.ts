import { REWRITE_RULES, SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

export const Expand: IPrompt = {
  name: 'Expand',
  system: `You are an expert at expanding and elaborating on ideas with relevant details. ${SAME_LANGUAGE}`,
  prompt: `${REWRITE_RULES}

Please expand the following text, providing more details and depth:
"""
{content}
"""`,
  output: PromptOutputType.replace,
};
