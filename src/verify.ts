/**
 * The loop behind the commands that check a claim against sources: the model
 * is offered a search tool, runs as many searches as it wants, and only then
 * answers. Kept separate from `chat()` so the plain commands stay a single
 * round trip.
 */
import { ChatMessage, ChatOptions, ChatResult, chat } from './deepseek';
import { SearchResult, formatForModel } from './search';

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

export interface VerifyResult extends ChatResult {
  /** The queries the model actually ran, in order. */
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
 * the way. A failing search is reported back to the model as the tool's reply
 * rather than thrown: the model can then say it could not verify the claim,
 * which is more useful than the whole command failing.
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

  for (let hop = 0; hop <= maxHops; hop++) {
    // On the last pass the tool is withdrawn, which forces an answer.
    const tools = hop < maxHops ? [SEARCH_TOOL] : undefined;
    const result = await ask(history, { ...options, tools });

    if (!result.toolCalls?.length) {
      return { ...result, queries };
    }

    history.push({ role: 'assistant', content: result.content, tool_calls: result.toolCalls });
    for (const call of result.toolCalls) {
      const query = parseQuery(call.function.arguments);
      let reply: string;
      if (call.function.name !== 'web_search') {
        reply = `Unknown tool "${call.function.name}".`;
      } else if (!query.trim()) {
        reply = 'No query given.';
      } else {
        queries.push(query);
        try {
          reply = formatForModel(await deps.search(query));
        } catch (error) {
          reply = `Search failed: ${(error as Error).message}`;
        }
      }
      history.push({ role: 'tool', tool_call_id: call.id, content: reply });
    }
  }

  throw new Error(
    `DeepSeek kept searching without answering (${maxHops} rounds). Try a shorter block.`,
  );
}
