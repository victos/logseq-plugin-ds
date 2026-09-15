/**
 * The loop behind the commands that check a claim against sources: the model
 * is offered a search tool, runs as many searches as it wants, and only then
 * answers. Kept separate from `chat()` so the plain commands stay a single
 * round trip.
 */
import { ChatMessage, ChatOptions, ChatResult, ToolCall, chat } from './deepseek';
import { SearchResult, SearchUnavailableError, formatForModel } from './search';

export const SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description:
      'Search the web for evidence about a factual claim. Use it for anything you are not ' +
      'certain of, and always for dates, version numbers, prices, statistics and recent ' +
      'events — your own knowledge has a cutoff and may be out of date.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A short search query. English usually returns better sources.',
        },
      },
      required: ['query'],
    },
  },
};

/** How many rounds of searching before the model has to answer with what it has. */
export const MAX_SEARCH_HOPS = 4;

/**
 * Said to the model before the last pass. Forbidding the tool through the API
 * alone is not enough: deepseek-reasoner, refused a call it wanted to make,
 * writes the call out as text instead of answering. Told in the conversation,
 * it answers.
 */
export const ANSWER_NOW =
  'Search is no longer available in this conversation. Do not call any tool. Answer now, ' +
  'in the format requested, from the results you already have; mark any claim you could not ' +
  'settle with ❓.';

/**
 * The model's own tool-call syntax leaking into the text. Seen from
 * deepseek-reasoner as `<｜DSML｜ calls>…`; such a reply is not an answer and
 * must never reach the block.
 */
const LEAKED_TOOL_MARKUP = /<｜+DSML｜+|<tool_call>|<function_calls?>/i;

export interface VerifyResult extends ChatResult {
  /** The queries the model asked for, in order. A repeat is answered from the earlier result. */
  queries: string[];
}

export interface VerifyDeps {
  chat?: typeof chat;
  search: (query: string) => Promise<SearchResult>;
  maxHops?: number;
}

function parseQuery(args: string): string {
  try {
    const parsed = JSON.parse(args) as { query?: unknown };
    return typeof parsed.query === 'string' ? parsed.query : '';
  } catch {
    return '';
  }
}

/**
 * Runs the conversation to completion, serving any `web_search` calls along
 * the way. A search that fails for a passing reason (timeout, network, a 5xx)
 * is reported back to the model as the tool's reply rather than thrown: the
 * model can then say it could not verify the claim, which is more useful than
 * the whole command failing. A {@link SearchUnavailableError} — no key, bad
 * key, quota gone — is thrown, because there the user has something to fix and
 * the model could only produce a page of ❓.
 */
export async function verifyWithSearch(
  messages: ChatMessage[],
  options: ChatOptions,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  const ask = deps.chat ?? chat;
  const maxHops = deps.maxHops ?? MAX_SEARCH_HOPS;
  const history = [...messages];
  const queries: string[] = [];
  const served = new Map<string, string>();

  for (let hop = 0; hop <= maxHops; hop++) {
    // The tool definitions stay in every request: the history holds tool calls
    // and their replies, and deepseek-reasoner, asked to continue that history
    // with no tools declared, writes raw tool-call markup as its answer. On the
    // last pass calling is forbidden and the model is told so, which forces an
    // answer.
    const last = hop === maxHops;
    if (last) {
      history.push({ role: 'user', content: ANSWER_NOW });
    }
    const result = await ask(history, {
      ...options,
      tools: [SEARCH_TOOL],
      toolChoice: last ? 'none' : undefined,
    });

    if (!result.toolCalls?.length) {
      if (LEAKED_TOOL_MARKUP.test(result.content)) {
        break;
      }
      return { ...result, queries };
    }
    if (last) {
      break;
    }

    history.push({ role: 'assistant', content: result.content, tool_calls: result.toolCalls });
    for (const call of result.toolCalls) {
      const reply = await serve(call, deps, queries, served);
      history.push({ role: 'tool', tool_call_id: call.id, content: reply });
    }
  }

  throw new Error(
    `DeepSeek kept searching without answering (${maxHops} rounds). Try a shorter block.`,
  );
}

async function serve(
  call: ToolCall,
  deps: VerifyDeps,
  queries: string[],
  served: Map<string, string>,
): Promise<string> {
  if (call.function.name !== 'web_search') {
    return `Unknown tool "${call.function.name}".`;
  }
  const query = parseQuery(call.function.arguments).trim();
  if (!query) {
    return 'No query given.';
  }
  queries.push(query);

  // The same query twice in one run is the model going round in circles; the
  // answer has not changed, and each search costs a credit.
  const earlier = served.get(query);
  if (earlier !== undefined) {
    return earlier;
  }
  try {
    const reply = formatForModel(await deps.search(query));
    served.set(query, reply);
    return reply;
  } catch (error) {
    if (error instanceof SearchUnavailableError) {
      throw error;
    }
    return `Search failed: ${(error as Error).message}`;
  }
}
