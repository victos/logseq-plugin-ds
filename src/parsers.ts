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
// `❌ claim → ✅ correction` where the correction just repeats the claim is the
// model filling in a row for a statement it found nothing wrong with. Observed
// from Fact Check: "❌ It can help you write a note. → ✅ It can help you write
// a note. (This statement is true.)"
const VERDICT = /^\s*❌\s*(.+?)\s*→\s*✅\s*(.+)$/;
// What may follow the repeated claim and still mean "nothing wrong here".
const AFFIRMATION =
  /^(?:(?:this|that|it|which|thestatement|thisstatement|thisclaim)?(?:is|s)?(?:true|correct|accurate|right|fine|ok)|(?:这|此|该|这句|此句|这句话|这一说法|该说法|说法)?(?:是|为)?(?:正确|对|准确|属实|无误|成立)的?)?$/;
const normalise = (s: string) => s.replace(/[\s.,;:!?。，、；：！？"'“”‘’()（）]/g, '').toLowerCase();

export function isNonFinding(line: string): boolean {
  const match = VERDICT.exec(line);
  if (!match) {
    return false;
  }
  const claim = normalise(match[1]);
  // The correction often trails a parenthesised reason; compare only its head.
  const correction = normalise(match[2].replace(/[（(][^）)]*[）)]\s*$/, ''));
  if (claim.length === 0 || !correction.startsWith(claim)) {
    return false;
  }
  // A real correction can begin with the claim's own words ("X is flat → X is
  // flat only near the poles"); only an affirmation after them means no finding.
  return AFFIRMATION.test(correction.slice(claim.length));
}
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
        .filter(Boolean)
        .filter((line) => !isNonFinding(line));
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
