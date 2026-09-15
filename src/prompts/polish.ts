import { IPrompt, PromptOutputType } from './type';

export const Polish: IPrompt = {
  name: 'Polish',
  system:
    "You are a meticulous copy editor. You improve clarity and flow without changing " +
    "the author's voice. Always reply in the same language as the user's text.",
  prompt: `Please polish the following text: fix awkward phrasing, redundancy and grammar.
Keep the original meaning, tone and level of detail — do not add, remove or invent information:
"""
{content}
"""`,
  output: PromptOutputType.replace,
};
