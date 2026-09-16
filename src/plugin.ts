/**
 * Everything the plugin does between Logseq and the modules that do the work:
 * reading the settings, registering the slash commands, running one, and
 * turning what goes wrong into a notification that says what to change.
 *
 * It talks to Logseq only through {@link PluginHost}, so that `main.ts` is a
 * few lines of wiring and this file can be run against a fake host — a fresh
 * install with nothing configured, a settings file edited by hand, a key
 * cleared while a command was still registered.
 */
import { propertyKey, stripTag, tagSuffix, withTag } from './block';
import { BlockOps } from './graph';
import { chat, ChatMessage, ChatOptions, ChatResult } from './deepseek';
import { getOutputParser, OutputParser } from './parsers';
import { buildUserMessage, DEFAULT_SYSTEM, resolvePrompts } from './prompt';
import { presetPrompts } from './prompts';
import { IPrompt, PromptOutputType } from './prompts/type';
import { NO_SEARCH_KEY_MESSAGE, search } from './search';
import { ISettings, SETTING_DEFAULTS, readSettings } from './settings';
import { verifyWithSearch } from './verify';

export type MessageStatus = 'info' | 'success' | 'warning' | 'error';

/** The slice of `logseq.UI` used: a toast that returns its key, and a way to close it. */
export interface Notifier {
  showMsg(message: string, status: MessageStatus, opts?: { timeout?: number }): Promise<string> | string;
  closeMsg(key: string): void;
}

export interface PluginHost {
  /** The settings as stored right now; read again on every use so edits apply at once. */
  settings(): unknown;
  /** The adapter for the graph that is open right now. */
  ops(): Promise<BlockOps>;
  ui: Notifier;
  registerSlashCommand(name: string, run: (uuid: string) => Promise<void>): void;
  onSettingsChanged(callback: () => void): void;
  /** Injection points; the real functions are used when absent. */
  chat?: typeof chat;
  verify?: typeof verifyWithSearch;
  search?: typeof search;
  log?: Pick<Console, 'debug' | 'warn' | 'error'>;
}

export const NO_API_KEY_AT_START =
  'DeepSeek Assistant: no API key set yet. Open the plugin settings and paste your DeepSeek ' +
  'key (https://platform.deepseek.com/api_keys) before running a command.';

export const COMMANDS_CHANGED =
  'Available commands changed. Reload the plugin to update the slash menu.';

function currentSettings(host: PluginHost): ISettings {
  return readSettings(host.settings());
}

function currentPrompts(host: PluginHost) {
  const settings = currentSettings(host);
  return resolvePrompts(presetPrompts, settings.customPrompts, Boolean(settings.searchApiKey.trim()));
}

/**
 * The request options for one command: the prompt's own model first, then
 * the settings, then the defaults. A field cleared to spaces counts as
 * cleared; sent as it stood it would fail as "no model configured" when the
 * user meant "the default".
 */
export function chatOptionsFor(settings: ISettings, definition: IPrompt): ChatOptions {
  return {
    apiKey: settings.apiKey.trim(),
    basePath: settings.basePath.trim() || SETTING_DEFAULTS.basePath,
    model: definition.model?.trim() || settings.model.trim() || SETTING_DEFAULTS.model,
    temperature: settings.temperature,
  };
}

/** The response as the pieces the output mode works with: one per list item or `key: value` pair. */
export function responseItems(parser: OutputParser | undefined, response: string): string[] {
  if (!parser) {
    return [response];
  }
  if (parser.kind === 'structured') {
    return Object.entries(parser.parse(response)).map(([name, text]) => `${name}: ${text}`);
  }
  return parser.parse(response);
}

export async function runPrompt(definition: IPrompt, uuid: string, host: PluginHost): Promise<void> {
  const settings = currentSettings(host);
  const tag = tagSuffix(settings.tag);
  const { ui } = host;

  // Which adapter applies is resolved per invocation, so switching between a
  // file graph and a DB graph does not need a plugin reload.
  const ops = await host.ops();

  const content = stripTag(await ops.readContext(uuid, tag), tag).trim();
  if (!content) {
    await ui.showMsg('The block is empty — nothing to send to DeepSeek.', 'warning');
    return;
  }
  if (definition.output === PromptOutputType.replace) {
    // The outline's first line is the block itself. With no text of its own,
    // the first child would take that place and every line after it would be
    // written back one block off — so the rewrite is refused instead.
    const own = await ops.readText(uuid);
    if (!stripTag(own ?? '', tag).trim()) {
      await ui.showMsg(
        'This block has no text of its own to rewrite. Run the command on a block with text, or on one of the children.',
        'warning',
      );
      return;
    }
  }

  const parser = getOutputParser(definition.format);
  const messages: ChatMessage[] = [
    { role: 'system', content: definition.system || DEFAULT_SYSTEM },
    {
      role: 'user',
      content: buildUserMessage(definition.prompt, content, parser?.formatInstructions),
    },
  ];
  const chatOptions = chatOptionsFor(settings, definition);

  // One line per run, so "the wrong thing happened" can be traced to the command
  // that actually ran and the text it actually saw, without guessing.
  host.log?.debug(
    `[DeepSeek Assistant] /${definition.name} -> ${definition.output}`,
    { model: chatOptions.model, messages },
  );

  const searchApiKey = settings.searchApiKey.trim();
  if (definition.requiresSearch && !searchApiKey) {
    // The command was registered while a key was set and the key has since
    // been cleared; it cannot be unregistered until the plugin reloads.
    throw new Error(NO_SEARCH_KEY_MESSAGE);
  }

  const pending = await ui.showMsg(
    definition.requiresSearch ? `${definition.name}… (searching)` : `${definition.name}…`,
    'info',
    { timeout: 0 },
  );
  let result: ChatResult;
  try {
    const ask = host.chat ?? chat;
    const doSearch = host.search ?? search;
    result = definition.requiresSearch
      ? await (host.verify ?? verifyWithSearch)(messages, chatOptions, {
          chat: ask,
          search: (query) => doSearch(query, { apiKey: searchApiKey }),
        })
      : await ask(messages, chatOptions);
  } finally {
    ui.closeMsg(pending);
  }
  const response = result.content;

  // Re-read: the user may have kept typing while the request was in flight.
  if ((await ops.readText(uuid)) === null) {
    await ui.showMsg('The block was deleted while DeepSeek was answering.', 'warning');
    return;
  }

  switch (definition.output) {
    case PromptOutputType.property: {
      const value = responseItems(parser, response).join(parser ? ', ' : '');
      await ops.setProperty(uuid, propertyKey(definition.name), value, tag);
      break;
    }
    case PromptOutputType.insert: {
      const items = responseItems(parser, response);
      if (items.length === 0) {
        await ui.showMsg('DeepSeek returned nothing to insert.', 'warning');
      }
      // The tag marks AI-written text, so it goes on the new child blocks; the
      // user's own block is not touched (this is what makes Fact Check safe).
      for (const item of items) {
        await ops.insertChild(uuid, withTag(item, tag));
      }
      break;
    }
    case PromptOutputType.replace: {
      // Rewrites cover the block and everything under it, so the reply is an
      // outline applied over the existing blocks rather than one string.
      const kept = await ops.rewriteSubtree(uuid, response, tag);
      if (kept > 0) {
        await ui.showMsg(
          `${kept} block(s) were left as they were: something links to them, or they hold ` +
            'notes DeepSeek was not shown. Delete them by hand if you want them gone.',
          'warning',
        );
      }
      break;
    }
    case PromptOutputType.append:
      await ops.appendText(uuid, response, tag);
      break;
  }

  if (result.finishReason === 'length') {
    await ui.showMsg(
      'DeepSeek stopped at its output limit — the answer may be cut off.',
      'warning',
    );
  }
}

function reportProblems(host: PluginHost, problems: string[]) {
  if (problems.length === 0) {
    return;
  }
  host.log?.warn('[DeepSeek Assistant] ignored custom prompts:', problems);
  void host.ui.showMsg(
    `DeepSeek Assistant ignored ${problems.length} custom prompt(s):\n${problems.join('\n')}`,
    'warning',
  );
}

/**
 * Registers the commands and keeps watching the settings. Called once, when
 * Logseq says the plugin is ready.
 */
export function startPlugin(host: PluginHost): void {
  const { prompts, problems } = currentPrompts(host);
  const registered = new Set(prompts.map((prompt) => prompt.name));
  reportProblems(host, problems);
  if (!currentSettings(host).apiKey.trim()) {
    // Said once, at load: otherwise a fresh install finds out on its first
    // command, after the "Summarize…" toast has already come and gone.
    void host.ui.showMsg(NO_API_KEY_AT_START, 'warning');
  }

  for (const definition of prompts) {
    const { name } = definition;
    host.registerSlashCommand(name, async (uuid) => {
      try {
        // Resolve again at call time so edits to an existing custom prompt
        // (text, output, model, format) apply without a reload. A prompt that
        // was removed keeps its last definition — the command cannot be unregistered.
        const current = currentPrompts(host).prompts.find((prompt) => prompt.name === name) ?? definition;
        await runPrompt(current, uuid, host);
      } catch (error) {
        host.log?.error(error);
        const message = error instanceof Error ? error.message : String(error);
        await host.ui.showMsg(message, 'error');
      }
    });
  }

  // Slash commands cannot be unregistered, so re-running the registration
  // here would duplicate every command. Ask for a reload instead when the set
  // of names moves — a custom prompt added or renamed, or the search key set
  // or cleared. Said once per change of the set, not on every later edit to
  // an unrelated setting.
  let lastProblems = problems.join('\n');
  let lastWarnedNames = '';
  host.onSettingsChanged(() => {
    const next = currentPrompts(host);
    const names = next.prompts.map((prompt) => prompt.name);
    const changed = names.length !== registered.size || names.some((name) => !registered.has(name));
    const key = names.join('\n');
    if (changed && key !== lastWarnedNames) {
      void host.ui.showMsg(COMMANDS_CHANGED, 'warning');
    }
    lastWarnedNames = changed ? key : '';
    const nextProblems = next.problems.join('\n');
    if (nextProblems !== lastProblems) {
      lastProblems = nextProblems;
      reportProblems(host, next.problems);
    }
  });
}
