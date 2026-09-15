import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin.user';
import { IPrompt } from './prompts/type';

export interface ISettings {
  apiKey: string;
  basePath: string;
  model: string;
  temperature: number;
  tag: string;
  customPrompts: {
    enable: boolean;
    prompts: IPrompt[];
  };
}

export const SETTING_DEFAULTS = {
  basePath: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  temperature: 1.0,
  tag: '[[🤖]]',
} as const;

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
      'Sampling temperature, 0.0 - 2.0. DeepSeek suggests 0.0 for code, 1.0 for ' +
      'rewriting and data extraction, 1.3 for chat, 1.5 for creative writing. ' +
      'Ignored by deepseek-reasoner.',
    default: SETTING_DEFAULTS.temperature,
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
