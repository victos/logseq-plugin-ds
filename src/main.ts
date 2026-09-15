import '@logseq/libs';
import { propertyKey, stripTag, tagSuffix, withTag } from './block';
import { blockOps } from './graph';
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
  const { apiKey, basePath, model, temperature, tag: tagName } = getSettings();
  const tag = tagSuffix(tagName);

  // Which adapter applies is resolved per invocation, so switching between a
  // file graph and a DB graph does not need a plugin reload.
  const ops = await blockOps(logseq.App, logseq.Editor);

  const content = stripTag(await ops.readContext(uuid, tag), tag).trim();
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

  // One line per run, so "the wrong thing happened" can be traced to the command
  // that actually ran and the text it actually saw, without guessing.
  console.debug(
    `[DeepSeek Assistant] /${definition.name} -> ${definition.output}`,
    { model: definition.model || model || SETTING_DEFAULTS.model, messages },
  );

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

  // Re-read: the user may have kept typing while the request was in flight.
  if ((await ops.readText(uuid)) === null) {
    await logseq.UI.showMsg('The block was deleted while DeepSeek was answering.', 'warning');
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
        await logseq.UI.showMsg(
          `${kept} block(s) were left as they were: something links to them, and removing ` +
            'them would break the reference. Delete them by hand if you want them gone.',
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
