import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin.user';
import { DEFAULT_BASE_PATH } from './deepseek';
import { IPrompt } from './prompts/type';

/** The settings as the plugin uses them; see {@link readSettings}. */
export interface ISettings {
  apiKey: string;
  basePath: string;
  model: string;
  temperature: number | undefined;
  searchApiKey: string;
  tag: string;
  /** Validated by `resolvePrompts`; anything may be in the settings file. */
  customPrompts: unknown;
}

/** What a well-formed `customPrompts` looks like. */
export interface CustomPromptsSetting {
  enable?: boolean;
  prompts?: IPrompt[];
}

export const SETTING_DEFAULTS = {
  basePath: DEFAULT_BASE_PATH,
  model: 'deepseek-chat',
  temperature: 0.3,
  tag: '[[🤖]]',
} as const;

/**
 * Logseq's settings panel saves a `number` field as a string once the user has
 * touched it (`"temperature": "0.3"` in the settings file), and a string is not
 * a temperature the client will send. Blank or unparseable means "not set".
 */
export function readTemperature(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    return Number(value);
  }
  return undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The stored settings made safe to use. Logseq's settings panel keeps every
 * text field a string, but the settings file can be edited by hand, and a
 * number or `null` where a string is expected used to throw inside a command
 * ("apiKey.trim is not a function") — or, for `searchApiKey`, at startup,
 * before any command was registered. Missing and wrong-typed values read as
 * unset; the defaults are applied where they are used.
 */
export function readSettings(raw: unknown): ISettings {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    apiKey: text(s.apiKey),
    basePath: text(s.basePath),
    model: text(s.model),
    temperature: readTemperature(s.temperature),
    searchApiKey: text(s.searchApiKey),
    tag: text(s.tag),
    customPrompts: s.customPrompts,
  };
}

const settings: SettingSchemaDesc[] = [
  {
    key: 'apiKey',
    type: 'string',
    title: 'API Key',
    description:
      'Your DeepSeek API key. Create one at https://platform.deepseek.com/api_keys',
    default: '',
  },
  {
    key: 'basePath',
    type: 'string',
    title: 'API Base URL',
    description:
      'DeepSeek API base URL. Change it only if you use a proxy or another ' +
      'OpenAI-compatible endpoint.',
    default: SETTING_DEFAULTS.basePath,
  },
  {
    key: 'model',
    type: 'string',
    title: 'Model',
    description:
      'Model name: "deepseek-chat" (fast, general purpose) or "deepseek-reasoner" ' +
      '(slower, better at reasoning). Individual custom prompts can override this.',
    default: SETTING_DEFAULTS.model,
  },
  {
    key: 'temperature',
    type: 'number',
    title: 'Temperature',
    description:
      'Sampling temperature, 0.0 - 2.0. Low values keep the answer close to your ' +
      'own text, which suits the rewriting commands (Polish, Shorten, Tone). Raise ' +
      'it towards 1.3 if you want Brainstorm or Ask AI to range wider. Ignored by ' +
      'deepseek-reasoner.',
    default: SETTING_DEFAULTS.temperature,
  },
  {
    key: 'searchApiKey',
    type: 'string',
    title: 'Web Search API Key (optional)',
    description:
      'A Tavily API key (https://tavily.com), which enables the "/Verify Online" command. ' +
      'That command searches the web and cites a source for every verdict; without a key it ' +
      'is not registered at all and nothing else changes. Reload the plugin after setting it.',
    default: '',
  },
  {
    key: 'tag',
    type: 'string',
    title: 'Tag',
    description:
      'Tag appended to AI-generated content (without the leading #). Leave empty ' +
      'to disable.',
    default: SETTING_DEFAULTS.tag,
  },
  {
    key: 'customPrompts',
    type: 'object',
    title: 'Custom Prompts',
    description:
      'Enable and manage custom prompts. Edits to an existing prompt apply at once; ' +
      'reload the plugin after adding or renaming one so its slash command is registered.',
    default: {
      enable: false,
      prompts: [],
    },
  },
];

export default settings;
