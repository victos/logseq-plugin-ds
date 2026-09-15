import { SAME_LANGUAGE } from './shared';
import { IPrompt, PromptOutputType } from './type';

/**
 * The counterpart to Fact Check: where that one judges from the model's own
 * knowledge, this one has to go and look, and every line it writes carries the
 * source it relied on. Needs a search API key, so it is only registered when
 * one is configured.
 */
export const VerifyOnline: IPrompt = {
  name: 'Verify Online',
  system:
    'You are a fact checker who works from sources, never from memory. You search before ' +
    `you judge, and you never state a verdict you cannot attribute to a source. ${SAME_LANGUAGE}`,
  prompt: `Check the following text against web sources:
"""
{content}
"""
Search first — at least once, and again for every separate claim worth checking. Do not answer from memory.

Write one line per claim you checked, in one of these three forms:
✅ <the claim> — <url>
❌ <the claim> → <what the sources say> — <url>
❓ <the claim> — no reliable source found

Every ✅ and ❌ line must end with the URL of the source it rests on. Use a real URL from the search results, never one you made up.
Check the claims that can be checked; say nothing about matters of opinion or prediction.`,
  output: PromptOutputType.insert,
  format: [],
  requiresSearch: true,
};
