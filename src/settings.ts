import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin.user';
import { IPrompt } from './prompts/type';

export interface ISettings {
  apiKey: string;
  basePath: string;
  model: string;
  temperature: number;
  searchApiKey: string;
  tag: string;
  customPrompts: {
    enable: boolean;
    prompts: IPrompt[];
  };
}

export const SETTING_DEFAULTS = {
  basePath: 'https://api.deepseek.com/v1',
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
