/**
 * Web search, used only by the commands that verify a claim against sources.
 * Tavily is called rather than a plain SERP API because it returns cleaned
 * page text: a plugin runs in a browser sandbox and cannot fetch arbitrary
 * pages itself — almost none of them send CORS headers.
 */

export interface SearchOptions {
  apiKey: string;
  /** Results to ask for. More costs the same but spends more of the model's context. */
  maxResults?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SearchHit {
  title: string;
  url: string;
  content: string;
}

export interface SearchResult {
  /** Tavily's own one-paragraph synthesis, when it returns one. */
  answer?: string;
  hits: SearchHit[];
}

export const SEARCH_ENDPOINT = 'https://api.tavily.com/search';
export const NO_SEARCH_KEY_MESSAGE = 'No Tavily API key configured. Set it in the plugin settings.';

/**
 * A failure that nothing within the run can cure: no key, a rejected key, an
 * exhausted quota. The search loop lets it surface as the command's error, so
 * the user learns what to fix; every other failure is handed to the model as
 * the tool's reply, and the model says it could not verify the claim.
 */
export class SearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchUnavailableError';
  }
}
export const DEFAULT_SEARCH_TIMEOUT_MS = 30 * 1000;
/** Per hit. Enough to settle a claim without crowding out the block itself. */
export const MAX_HIT_CHARS = 900;

interface TavilyResponse {
  answer?: unknown;
  results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
  detail?: unknown;
  error?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function describeError(status: number, body: string): Error {
  let detail = body.slice(0, 200);
  try {
    const parsed = JSON.parse(body) as TavilyResponse;
    // Tavily answers `{"detail":{"error":"…"}}` (seen live); older shapes were flat.
    const d = parsed.detail ?? parsed.error;
    const inner = typeof d === 'object' && d !== null ? (d as { error?: unknown }).error ?? d : d;
    detail = typeof inner === 'string' ? inner : JSON.stringify(inner ?? detail);
  } catch {
    // keep the raw body
  }
  switch (status) {
    case 401:
    case 403:
      return new SearchUnavailableError(`Invalid Tavily API key (${status}): ${detail}`);
    case 429:
      return new SearchUnavailableError(`Tavily rate limit or monthly quota reached (429): ${detail}`);
    case 432:
    case 433:
      return new SearchUnavailableError(`Tavily plan limit reached (${status}): ${detail}`);
    default:
      return new Error(`Web search failed (${status}): ${detail}`);
  }
}

export async function search(
  query: string,
  options: SearchOptions,
  doFetch: typeof fetch = fetch,
): Promise<SearchResult> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new SearchUnavailableError(NO_SEARCH_KEY_MESSAGE);
  }
  if (!query.trim()) {
    throw new Error('Empty search query.');
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forward = () => controller.abort();
  if (options.signal?.aborted) {
    forward();
  } else {
    options.signal?.addEventListener('abort', forward, { once: true });
  }

  let response: Response;
  let body: string;
  try {
    try {
      response = await doFetch(SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query: query.trim(),
          max_results: options.maxResults ?? 3,
          include_answer: true,
          search_depth: 'basic',
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new Error(`Web search did not answer within ${Math.round(timeoutMs / 1000)} s.`);
      }
      if (controller.signal.aborted) {
        throw new Error('Web search was cancelled.');
      }
      throw new Error(`Could not reach the search service: ${(error as Error).message}`);
    }
    body = await response.text();
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forward);
  }

  if (!response.ok) {
    throw describeError(response.status, body);
  }

  let payload: TavilyResponse;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`The search service returned a non-JSON response: ${body.slice(0, 200)}`);
  }

  const hits: SearchHit[] = (payload.results ?? [])
    .map((r) => ({
      title: text(r.title),
      url: text(r.url),
      content: text(r.content).slice(0, MAX_HIT_CHARS),
    }))
    .filter((h) => h.url);

  const answer = text(payload.answer).trim();
  return { ...(answer ? { answer } : {}), hits };
}

/** The search result as the model sees it, as a tool reply. */
export function formatForModel(result: SearchResult): string {
  const parts = result.answer ? [`Summary: ${result.answer}`] : [];
  if (result.hits.length === 0) {
    parts.push('No results.');
  }
  result.hits.forEach((h, i) => {
    parts.push(`[${i + 1}] ${h.title}\nURL: ${h.url}\n${h.content}`);
  });
  return parts.join('\n\n');
}
