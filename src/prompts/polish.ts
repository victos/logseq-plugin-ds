import { REWRITE_RULES, SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

export const Polish: IPrompt = {
  name: 'Polish',
  system:
    'You are a meticulous copy editor. You improve clarity and flow without changing ' +
    `the author’s voice. ${SAME_LANGUAGE}`,
  prompt: `${REWRITE_RULES}

Please polish the following text: fix awkward phrasing, redundancy and grammar.
Keep the original meaning, tone and level of detail — do not add, remove or invent information:
"""
{content}
"""`,
  output: PromptOutputType.replace,
};
