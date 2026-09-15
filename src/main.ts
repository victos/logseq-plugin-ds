import '@logseq/libs';
import {
  blockToText,
  composeAppend,
  composeProperty,
  composeReplace,
  propertyKey,
  readCurrentContent,
  stripTag,
  tagSuffix,
  withTag,
} from './block';
import { chat, ChatMessage, ChatResult } from './deepseek';
import { getOutputParser, OutputParser } from './parsers';
import { buildUserMessage, DEFAULT_SYSTEM, resolvePrompts } from './prompt';
import { presetPrompts } from './prompts';
import { IPrompt, PromptOutputType } from './prompts/type';
import settings, { ISettings, SETTING_DEFAULTS } from './settings';

function getSettings(): ISettings {
  return (logseq.settings ?? {}) as unknown as ISettings;
}

function getPrompts() {
  return resolvePrompts(presetPrompts, getSettings().customPrompts);
}

const currentContent = (uuid: string) => readCurrentContent(logseq.Editor, uuid);

/** The response as the pieces the output mode works with: one per list item or `key: value` pair. */
function responseItems(parser: OutputParser | undefined, response: string): string[] {
  if (!parser) {
    return [response];
  }
  if (parser.kind === 'structured') {
    return Object.entries(parser.parse(response)).map(([name, text]) => `${name}: ${text}`);
  }
  return parser.parse(response);
}

async function runPrompt(definition: IPrompt, uuid: string) {
  const block = await logseq.Editor.getBlock(uuid, { includeChildren: true });
  if (!block) {
    return;
  }

  const { apiKey, basePath, model, temperature, tag: tagName } = getSettings();
  const tag = tagSuffix(tagName);

  // Root text comes from the editor when the block is being edited (merged over
  // the saved content so hidden properties survive); children come from the DB.
  const rootContent = (await currentContent(uuid)) ?? block.content;
  const content = stripTag(blockToText({ ...block, content: rootContent }), tag).trim();
  if (!content) {
    await logseq.UI.showMsg('The block is empty — nothing to send to DeepSeek.', 'warning');
    return;
  }

  const parser = getOutputParser(definition.format);
  const messages: ChatMessage[] = [
    { role: 'system', content: definition.system || DEFAULT_SYSTEM },
    {
      role: 'user',
      content: buildUserMessage(definition.prompt, content, parser?.formatInstructions),
    },
  ];

  const pending = await logseq.UI.showMsg(`${definition.name}…`, 'info', { timeout: 0 });
  let result: ChatResult;
  try {
    result = await chat(messages, {
      apiKey,
      basePath: basePath || SETTING_DEFAULTS.basePath,
      model: definition.model || model || SETTING_DEFAULTS.model,
      temperature,
    });
  } finally {
    logseq.UI.closeMsg(pending);
  }
  const response = result.content;

  // Re-read (same merge): the user may have kept typing while the request was in flight.
  const latest = await currentContent(uuid);
  if (latest === null) {
    await logseq.UI.showMsg('The block was deleted while DeepSeek was answering.', 'warning');
    return;
  }

  const items = responseItems(parser, response);
  switch (definition.output) {
    case PromptOutputType.property: {
      const key = propertyKey(definition.name);
      const value = items.join(parser?.kind === 'structured' ? ' ' : ', ');
      await logseq.Editor.updateBlock(uuid, composeProperty(latest, key, value, tag));
      break;
    }
    case PromptOutputType.insert: {
      // The tag marks AI-written text, so it goes on the new child blocks; the
      // user's own block is not touched (this is what makes Fact Check safe).
      for (const item of items) {
        await logseq.Editor.insertBlock(uuid, withTag(item, tag));
      }
      break;
    }
    case PromptOutputType.replace:
      await logseq.Editor.updateBlock(uuid, composeReplace(latest, response, tag));
      break;
    case PromptOutputType.append:
      await logseq.Editor.updateBlock(uuid, composeAppend(latest, response, tag));
      break;
  }

  if (result.finishReason === 'length') {
    await logseq.UI.showMsg(
      'DeepSeek stopped at its output limit — the answer may be cut off.',
      'warning',
    );
  }
}

function reportProblems(problems: string[]) {
  if (problems.length === 0) {
    return;
  }
  console.warn('[DeepSeek Assistant] ignored custom prompts:', problems);
  logseq.UI.showMsg(
    `DeepSeek Assistant ignored ${problems.length} custom prompt(s):\n${problems.join('\n')}`,
    'warning',
  );
}

function main() {
  const { prompts, problems } = getPrompts();
  const registered = new Set(prompts.map((prompt) => prompt.name));
  reportProblems(problems);

  for (const definition of prompts) {
    const { name } = definition;
    logseq.Editor.registerSlashCommand(name, async ({ uuid }) => {
      try {
        // Resolve again at call time so edits to an existing custom prompt
        // (text, output, model, format) apply without a reload. A prompt that
        // was removed keeps its last definition — the command cannot be unregistered.
        const current = getPrompts().prompts.find((prompt) => prompt.name === name) ?? definition;
        await runPrompt(current, uuid);
      } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        await logseq.UI.showMsg(message, 'error');
      }
    });
  }

  // Slash commands cannot be unregistered, so re-running main() here would
  // duplicate every command. Ask for a reload instead when the set of names moves.
  let lastProblems = problems.join('\n');
  logseq.onSettingsChanged(() => {
    const next = getPrompts();
    const names = next.prompts.map((prompt) => prompt.name);
    const changed =
      names.length !== registered.size || names.some((name) => !registered.has(name));
    if (changed) {
      logseq.UI.showMsg(
        'Custom prompts changed. Reload the plugin to register the new slash commands.',
        'warning',
      );
    }
    const nextProblems = next.problems.join('\n');
    if (nextProblems !== lastProblems) {
      lastProblems = nextProblems;
      reportProblems(next.problems);
    }
  });
}

logseq.useSettingsSchema(settings).ready(main).catch(console.error);
