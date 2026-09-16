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
  if (raw.format !== undefined && raw.format !== null) {
    const format = raw.format;
    const shaped = Array.isArray(format) || (typeof format === 'object' && !Array.isArray(format));
    if (!shaped) {
      return {
        problem: `"${name}" has an invalid "format" (${JSON.stringify(format)}); ` +
          'expected [] for a list or {"key": "description"} for named fields',
      };
    }
    resolved.format = format as IPrompt['format'];
  }
  return { prompt: resolved };
}

const CUSTOM_PROMPTS_SHAPE = '{"enable": true, "prompts": [ … ]}';

/**
 * The entries of `customPrompts`, or the reason there are none. A setting of
 * the wrong shape is reported rather than skipped: someone who has just
 * written it wants to know why nothing happened. One that is switched off is
 * left alone whatever is in it.
 */
function customEntries(custom: unknown): { entries: unknown[] } | { problem?: string } {
  if (custom === undefined || custom === null) {
    return {};
  }
  if (Array.isArray(custom)) {
    return { problem: `customPrompts is a list; it must be an object like ${CUSTOM_PROMPTS_SHAPE}` };
  }
  if (typeof custom !== 'object') {
    return { problem: `customPrompts is ${JSON.stringify(custom)}; it must be an object like ${CUSTOM_PROMPTS_SHAPE}` };
  }
  const { enable, prompts } = custom as { enable?: unknown; prompts?: unknown };
  if (!enable) {
    return {};
  }
  if (!Array.isArray(prompts)) {
    return {
      problem: `customPrompts is enabled but "prompts" is ${prompts === undefined ? 'missing' : 'not a list'}; ` +
        `it must be an object like ${CUSTOM_PROMPTS_SHAPE}`,
    };
  }
  return { entries: prompts };
}

/**
 * Merges the built-in prompts with the enabled custom ones. A custom prompt
 * sharing a name with a built-in one replaces it, so Logseq never ends up
 * with two identical slash commands.
 */
export function resolvePrompts(
  presets: IPrompt[],
  custom: unknown,
  searchAvailable = false,
): ResolvedPrompts {
  // A command that needs web search is left out entirely rather than
  // registered and made to fail: an unusable entry in the slash menu is worse
  // than no entry.
  const usable = presets.filter((prompt) => !prompt.requiresSearch || searchAvailable);
  const byName = new Map(usable.map((prompt) => [prompt.name, prompt]));
  const problems: string[] = [];

  const custom_ = customEntries(custom);
  if ('entries' in custom_) {
    custom_.entries.forEach((entry, index) => {
      const result = validateCustomPrompt(entry, index);
      if ('problem' in result) {
        problems.push(result.problem);
      } else {
        byName.set(result.prompt.name, result.prompt);
      }
    });
  } else if (custom_.problem) {
    problems.push(custom_.problem);
  }

  return { prompts: [...byName.values()], problems };
}
