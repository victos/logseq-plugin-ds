import { REWRITE_RULES, SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

export const Shorten: IPrompt = {
  name: 'Shorten',
  system: `You are an expert at concise writing and summarization. ${SAME_LANGUAGE}`,
  prompt: `${REWRITE_RULES}

Please shorten the following text while maintaining its key points:
"""
{content}
"""`,
  output: PromptOutputType.replace,
};
