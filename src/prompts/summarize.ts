import { SAME_LANGUAGE, SOURCE_IS_MATERIAL } from './shared';
import { IPrompt, PromptOutputType } from './type';

export const Summarize: IPrompt = {
  name: 'Summarize',
  system: `You are an expert at creating concise and accurate summaries. ${SAME_LANGUAGE}`,
  prompt: `${SOURCE_IS_MATERIAL}

Please provide a concise summary of the following text:
"""
{content}
"""`,
  output: PromptOutputType.property,
};
