import { describe, expect, it, vi } from 'vitest';
import {
  MAX_HIT_CHARS,
  SEARCH_ENDPOINT,
  SearchUnavailableError,
  formatForModel,
  search,
} from '../src/search';

const KEY = { apiKey: 'tvly-test' };

function stub(status: number, body: unknown, capture?: (url: string, init: RequestInit) => void) {
  return (async (url: string, init: RequestInit) => {
    capture?.(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as Response;
  }) as unknown as typeof fetch;
}

const OK = {
  answer: 'RAM is memory, not storage.',
  results: [
    { title: 'RAM vs Storage', url: 'https://example.com/a', content: 'Internal storage writes…' },
    { title: 'No url', content: 'dropped' },
  ],
};

describe('search', () => {
  it('sends the key as a bearer token to the Tavily endpoint', async () => {
    let seen: { url?: string; init?: RequestInit } = {};
    await search('ram', KEY, stub(200, OK, (url, init) => (seen = { url, init })));
    expect(seen.url).toBe(SEARCH_ENDPOINT);
    expect((seen.init!.headers as Record<string, string>).Authorization).toBe('Bearer tvly-test');
    expect(JSON.parse(seen.init!.body as string)).toMatchObject({
      query: 'ram',
      include_answer: true,
      max_results: 3,
    });
  });

  it('trims a key pasted with whitespace', async () => {
    let seen: RequestInit | undefined;
    await search('ram', { apiKey: '  tvly-test\n' }, stub(200, OK, (_u, i) => (seen = i)));
    expect((seen!.headers as Record<string, string>).Authorization).toBe('Bearer tvly-test');
  });

  it('keeps the answer and drops results without a url', async () => {
    const r = await search('ram', KEY, stub(200, OK));
    expect(r.answer).toBe('RAM is memory, not storage.');
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].url).toBe('https://example.com/a');
  });

  // A whole page of text per hit would crowd the block out of the context.
  it('truncates each hit', async () => {
    const long = { results: [{ title: 't', url: 'https://e.com', content: 'x'.repeat(5000) }] };
    const r = await search('q', KEY, stub(200, long));
    expect(r.hits[0].content).toHaveLength(MAX_HIT_CHARS);
  });

  it('refuses to call out with no key or no query', async () => {
    const never = (() => {
      throw new Error('should not be called');
    }) as unknown as typeof fetch;
    await expect(search('q', { apiKey: '' }, never)).rejects.toThrow(/No Tavily API key/);
    await expect(search('q', { apiKey: ' \n' }, never)).rejects.toThrow(/No Tavily API key/);
    await expect(search('q', { apiKey: '' }, never)).rejects.toBeInstanceOf(SearchUnavailableError);
    await expect(search('  ', KEY, never)).rejects.toThrow(/Empty search query/);
  });

  it.each([
    [401, /Invalid Tavily API key \(401\)/],
    [403, /Invalid Tavily API key \(403\)/],
    [429, /rate limit or monthly quota/],
    [432, /plan limit reached \(432\)/],
    [500, /Web search failed \(500\)/],
  ])('explains HTTP %i', async (status, pattern) => {
    await expect(search('q', KEY, stub(status, { detail: 'nope' }))).rejects.toThrow(pattern);
  });

  // Key and quota problems are for the user to fix; the loop must not hide them
  // behind the model. Anything else may pass, and the model is told instead.
  it.each([
    [401, true],
    [403, true],
    [429, true],
    [432, true],
    [433, true],
    [400, false],
    [500, false],
    [502, false],
  ])('HTTP %i is unavailable: %s', async (status, unavailable) => {
    const error: unknown = await search('q', KEY, stub(status, { detail: 'x' })).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof SearchUnavailableError).toBe(unavailable);
  });

  // Seen live: Tavily wraps its message as {"detail":{"error":"…"}}.
  it('unwraps Tavily’s nested error body into the message', async () => {
    await expect(
      search('q', KEY, stub(401, { detail: { error: 'Unauthorized: missing or invalid API key.' } })),
    ).rejects.toThrow('Invalid Tavily API key (401): Unauthorized: missing or invalid API key.');
    await expect(search('q', KEY, stub(400, { detail: { error: 'Query is missing.' } }))).rejects.toThrow(
      'Web search failed (400): Query is missing.',
    );
  });

  it('reports a non-JSON body rather than crashing', async () => {
    await expect(search('q', KEY, stub(200, '<html>gateway</html>'))).rejects.toThrow(/non-JSON/);
  });

  it('times out', async () => {
    vi.useFakeTimers();
    // A real fetch rejects when its signal aborts; the stub has to as well.
    const hang = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      })) as unknown as typeof fetch;
    const pending = search('q', { ...KEY, timeoutMs: 30_000 }, hang);
    const assertion = expect(pending).rejects.toThrow(/did not answer within 30 s/);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    vi.useRealTimers();
  });

  it('honours a signal that was already aborted before the call', async () => {
    const controller = new AbortController();
    controller.abort();
    const hang = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init.signal!.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
        }
      })) as unknown as typeof fetch;
    await expect(search('q', { ...KEY, signal: controller.signal }, hang)).rejects.toThrow(
      /was cancelled/,
    );
  });

  it('honours an external abort signal', async () => {
    const controller = new AbortController();
    const hang = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      })) as unknown as typeof fetch;
    const pending = search('q', { ...KEY, signal: controller.signal }, hang);
    const assertion = expect(pending).rejects.toThrow(/was cancelled/);
    controller.abort();
    await assertion;
  });
});

describe('formatForModel', () => {
  it('puts the summary first and numbers the sources with their urls', () => {
    const out = formatForModel({
      answer: 'short answer',
      hits: [{ title: 'T', url: 'https://e.com/1', content: 'body' }],
    });
    expect(out).toBe('Summary: short answer\n\n[1] T\nURL: https://e.com/1\nbody');
  });

  it('says so when nothing was found', () => {
    expect(formatForModel({ hits: [] })).toBe('No results.');
  });
});
