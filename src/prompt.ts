import { IPrompt, PromptOutputType } from './prompts/type';

export const DEFAULT_SYSTEM =
  'You are a helpful assistant and will support the user with any task.';

// `{{text}}` is the placeholder documented for custom prompts, `{content}` the
// one used by the built-in ones.
const PLACEHOLDER = /\{\{text\}\}|\{content\}/g;

/**
 * Substitutes the block text into the prompt. A prompt with no placeholder
 * gets the text appended in triple quotes. Substitution is a single pass with
 * a literal replacement, so text that itself contains `{content}` or `$&` is
 * inserted verbatim.
 */
export function buildUserMessage(prompt: string, content: string, formatInstructions?: string) {
  let message = prompt.search(PLACEHOLDER) !== -1
    ? prompt.replace(PLACEHOLDER, () => content)
    : `${prompt}\n"""\n${content}\n"""`;

  if (formatInstructions) {
    message += `\n\n${formatInstructions}`;
  }
  return message;
}

export interface CustomPromptsSetting {
  enable?: boolean;
  prompts?: unknown;
}

export interface ResolvedPrompts {
  prompts: IPrompt[];
  /** Human-readable reasons for each custom prompt that was ignored. */
  problems: string[];
}

const OUTPUT_TYPES = new Set<string>(Object.values(PromptOutputType));

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Validates one entry of `customPrompts.prompts`; returns a reason when it is unusable. */
export function validateCustomPrompt(
  entry: unknown,
  index: number,
): { prompt: IPrompt } | { problem: string } {
  const label = `custom prompt #${index + 1}`;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return { problem: `${label} is not an object` };
  }

  const raw = entry as Record<string, unknown>;
  const name = optionalString(raw.name)?.trim();
  if (!name) {
    return { problem: `${label} has no "name"` };
  }
  const prompt = optionalString(raw.prompt);
  if (!prompt) {
    return { problem: `"${name}" has no "prompt"` };
  }
  const output = typeof raw.output === 'string' ? raw.output.trim().toLowerCase() : '';
  if (!OUTPUT_TYPES.has(output)) {
    return {
      problem: `"${name}" has an invalid "output" (${JSON.stringify(raw.output ?? null)}); ` +
        `expected one of ${[...OUTPUT_TYPES].join(', ')}`,
    };
  }

  const resolved: IPrompt = { name, prompt, output: output as PromptOutputType };
  const system = optionalString(raw.system);
  if (system) {
    resolved.system = system;
  }
  const model = optionalString(raw.model)?.trim();
  if (model) {
    resolved.model = model;
  }
  if (raw.format !== undefined) {
    resolved.format = raw.format as IPrompt['format'];
  }
  return { prompt: resolved };
}

/**
 * Merges the built-in prompts with the enabled custom ones. A custom prompt
 * sharing a name with a built-in one replaces it, so Logseq never ends up
 * with two identical slash commands.
 */
export function resolvePrompts(
  presets: IPrompt[],
  custom: CustomPromptsSetting | undefined | null,
  searchAvailable = false,
): ResolvedPrompts {
  // A command that needs web search is left out entirely rather than
  // registered and made to fail: an unusable entry in the slash menu is worse
  // than no entry.
  const usable = presets.filter((prompt) => !prompt.requiresSearch || searchAvailable);
  const byName = new Map(usable.map((prompt) => [prompt.name, prompt]));
  const problems: string[] = [];

  if (custom?.enable && Array.isArray(custom.prompts)) {
    custom.prompts.forEach((entry, index) => {
      const result = validateCustomPrompt(entry, index);
      if ('problem' in result) {
        problems.push(result.problem);
      } else {
        byName.set(result.prompt.name, result.prompt);
      }
    });
  }

  return { prompts: [...byName.values()], problems };
}
