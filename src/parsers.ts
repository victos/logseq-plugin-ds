export interface ListParser {
  kind: 'list';
  formatInstructions: string;
  parse(text: string): string[];
}

export interface StructuredParser {
  kind: 'structured';
  formatInstructions: string;
  parse(text: string): Record<string, string>;
}

export type OutputParser = ListParser | StructuredParser;

const BULLET = /^\s*(?:[-*+•]|\d+[.)])\s+/;
const FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

function listParser(): ListParser {
  return {
    kind: 'list',
    formatInstructions:
      'Respond with one item per line. Do not number the items, do not add bullet ' +
      'characters, and do not add any introduction or closing remarks.',
    parse(text: string) {
      return text
        .split('\n')
        .map((line) => line.replace(BULLET, '').trim())
        .filter(Boolean);
    },
  };
}

/** Renders whatever the model put under a key as a single string. */
function stringify(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stringify).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function structuredParser(schema: Record<string, string>): StructuredParser {
  const shape = Object.entries(schema)
    .map(([key, description]) => `  ${JSON.stringify(key)}: ${JSON.stringify(String(description))}`)
    .join(',\n');

  return {
    kind: 'structured',
    formatInstructions:
      'Respond with a single JSON object and nothing else — no prose, no markdown ' +
      `code fence. Every value must be a string. Use exactly these keys:\n{\n${shape}\n}`,
    parse(text: string) {
      const fenced = text.match(FENCE);
      let candidate = (fenced ? fenced[1] : text).trim();

      // Tolerate a model that wraps the object in a sentence.
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start !== -1 && end > start) {
        candidate = candidate.slice(start, end + 1);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(candidate);
      } catch {
        throw new Error(`Expected a JSON object but got: ${text.slice(0, 200)}`);
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`Expected a JSON object but got: ${text.slice(0, 200)}`);
      }

      const record: Record<string, string> = {};
      for (const key of Object.keys(schema)) {
        record[key] = stringify((parsed as Record<string, unknown>)[key]);
      }
      return record;
    },
  };
}

/**
 * `[]` (any array) selects the list parser, a non-empty object the structured
 * parser. Anything else — including `{}` — means free text.
 */
export function getOutputParser(format: unknown): OutputParser | undefined {
  if (Array.isArray(format)) {
    return listParser();
  }
  if (typeof format === 'object' && format !== null && Object.keys(format).length > 0) {
    return structuredParser(format as Record<string, string>);
  }
  return undefined;
}
