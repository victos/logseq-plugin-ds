export interface IPrompt {
  name: string;
  system?: string;
  prompt: string;
  output: PromptOutputType;
  /**
   * `[]` asks for a newline-separated list; `{ key: description }` asks for a
   * JSON object with exactly those keys. Anything else means free text.
   */
  format?: unknown[] | Record<string, string>;
  model?: string;
  /** Needs a search API key; the command is not registered without one. */
  requiresSearch?: boolean;
}

export enum PromptOutputType {
  property = 'property',
  replace = 'replace',
  insert = 'insert',
  append = 'append',
}
