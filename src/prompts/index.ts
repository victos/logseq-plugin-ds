import { AskAI } from './ask-ai';
import { AskOnline } from './ask-online';
import { Brainstorm } from './brainstorm';
import { Expand } from './expand';
import { Explain } from './explain';
import { FactCheck } from './fact-check';
import { Polish } from './polish';
import { Shorten } from './shorten';
import { Summarize } from './summarize';
import { ToneCasual } from './tone-casual';
import { VerifyOnline } from './verify-online';
import { ToneConfident } from './tone-confident';
import { ToneFriendly } from './tone-friendly';
import { ToneProfessional } from './tone-professional';
import { IPrompt } from './type';

export {
  AskAI, AskOnline, Brainstorm, Expand, Explain, FactCheck, Polish, Shorten, Summarize,
  ToneCasual, ToneConfident, ToneFriendly, ToneProfessional, VerifyOnline,
};

/**
 * The built-in commands, in the order they are registered. An explicit list:
 * `Object.values` over a module namespace is sorted alphabetically by export
 * name, which is not the grouping we want in the slash menu.
 */
export const presetPrompts: IPrompt[] = [
  AskAI,
  AskOnline,
  Summarize,
  Polish,
  Shorten,
  Expand,
  Explain,
  FactCheck,
  VerifyOnline,
  Brainstorm,
  ToneFriendly,
  ToneConfident,
  ToneCasual,
  ToneProfessional,
];
