import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRequestBody,
  chat,
  ChatMessage,
  describeHttpError,
  endpoint,
  isReasoner,
} from '../src/deepseek';

const MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'hi' },
];

const BASE = { apiKey: 'sk-test', basePath: 'https://api.deepseek.com/v1', model: 'deepseek-chat' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ok(content: string, finish_reason = 'stop') {
  return json({ choices: [{ message: { content, reasoning_content: 'thinking…' }, finish_reason }] });
}

/** A fetch stub that records the call and answers with the given response. */
function fakeFetch(response: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('endpoint', () => {
  it.each([
    ['https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/chat/completions'],
    ['https://api.deepseek.com/v1/', 'https://api.deepseek.com/v1/chat/completions'],
    ['https://api.deepseek.com', 'https://api.deepseek.com/chat/completions'],
    ['  https://proxy.local/openai/v1//  ', 'https://proxy.local/openai/v1/chat/completions'],
    ['https://proxy.local/v1/chat/completions', 'https://proxy.local/v1/chat/completions'],
  ])('%s -> %s', (input, expected) => {
    expect(endpoint(input)).toBe(expected);
  });
});

describe('isReasoner / buildRequestBody', () => {
  it('sends temperature for chat models only', () => {
    expect(isReasoner('deepseek-reasoner')).toBe(true);
    expect(isReasoner('deepseek-chat')).toBe(false);
    expect(buildRequestBody(MESSAGES, 'deepseek-chat', 0.7)).toEqual({
      model: 'deepseek-chat',
      messages: MESSAGES,
      stream: false,
      temperature: 0.7,
    });
    expect(buildRequestBody(MESSAGES, 'deepseek-reasoner', 0.7)).not.toHaveProperty('temperature');
  });

  it('omits tools when there are none, and sends tool_choice only with tools', () => {
    const tool = {
      type: 'function' as const,
      function: { name: 't', description: 'd', parameters: { type: 'object' } },
    };
    expect(buildRequestBody(MESSAGES, 'deepseek-chat', undefined)).not.toHaveProperty('tools');
    expect(buildRequestBody(MESSAGES, 'deepseek-chat', undefined, [])).not.toHaveProperty('tools');
    expect(buildRequestBody(MESSAGES, 'deepseek-chat', undefined, [], 'none')).not.toHaveProperty(
      'tool_choice',
    );
    expect(buildRequestBody(MESSAGES, 'deepseek-chat', undefined, [tool])).toMatchObject({
      tools: [tool],
    });
    expect(buildRequestBody(MESSAGES, 'deepseek-chat', undefined, [tool])).not.toHaveProperty(
      'tool_choice',
    );
    expect(buildRequestBody(MESSAGES, 'deepseek-chat', undefined, [tool], 'none')).toMatchObject({
      tools: [tool],
      tool_choice: 'none',
    });
  });

  it('omits a missing or non-finite temperature', () => {
    expect(buildRequestBody(MESSAGES, 'deepseek-chat', undefined)).not.toHaveProperty('temperature');
    expect(buildRequestBody(MESSAGES, 'deepseek-chat', NaN)).not.toHaveProperty('temperature');
    expect(buildRequestBody(MESSAGES, 'deepseek-chat', 0)).toHaveProperty('temperature', 0);
  });
});

describe('describeHttpError', () => {
  it('uses the API error message when the body is JSON, else the raw body', () => {
    expect(describeHttpError(401, JSON.stringify({ error: { message: 'bad key' } }))).toBe(
      'Invalid DeepSeek API key (401): bad key',
    );
    expect(describeHttpError(502, '<html>Bad Gateway</html>')).toBe(
      'DeepSeek is temporarily unavailable (502): <html>Bad Gateway</html>',
    );
  });

  it.each([
    [400, /malformed \(400\)/],
    [402, /insufficient balance \(402\)/],
    [422, /request parameters \(422\)/],
    [429, /rate limit reached \(429\)/],
    [500, /temporarily unavailable \(500\)/],
    [503, /temporarily unavailable \(503\)/],
    [418, /request failed \(418\)/],
  ])('maps %d', (status, pattern) => {
    expect(describeHttpError(status, '')).toMatch(pattern);
  });
});

describe('chat', () => {
  it('validates settings before touching the network', async () => {
    const { fetch, calls } = fakeFetch(ok('x'));
    await expect(chat(MESSAGES, { ...BASE, apiKey: '  ', fetch })).rejects.toThrow(/No DeepSeek API key/);
    await expect(chat(MESSAGES, { ...BASE, basePath: '', fetch })).rejects.toThrow(/No API Base URL/);
    await expect(chat(MESSAGES, { ...BASE, model: ' ', fetch })).rejects.toThrow(/No model/);
    expect(calls).toHaveLength(0);
  });

  it('POSTs the shaped request with a trimmed bearer token', async () => {
    const { fetch, calls } = fakeFetch(ok('  Answer  '));
    const result = await chat(MESSAGES, {
      ...BASE,
      apiKey: ' sk-test\n',
      basePath: 'https://api.deepseek.com/v1/',
      temperature: 1.3,
      fetch,
    });

    expect(result).toEqual({ content: 'Answer', finishReason: 'stop', reasoningContent: 'thinking…' });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'deepseek-chat',
      messages: MESSAGES,
      stream: false,
      temperature: 1.3,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the per-call model and drops temperature for the reasoner', async () => {
    const { fetch, calls } = fakeFetch(ok('x'));
    await chat(MESSAGES, { ...BASE, model: 'deepseek-reasoner', temperature: 1.3, fetch });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe('deepseek-reasoner');
    expect(body).not.toHaveProperty('temperature');
  });

  it('reports the finish reason so callers can warn about truncation', async () => {
    const { fetch } = fakeFetch(ok('partial', 'length'));
    await expect(chat(MESSAGES, { ...BASE, fetch })).resolves.toEqual({
      content: 'partial',
      finishReason: 'length',
      reasoningContent: 'thinking…',
    });
  });

  it.each([
    [401, { error: { message: 'Authentication Fails' } }, /Invalid DeepSeek API key \(401\): Authentication Fails/],
    [402, { error: { message: 'Insufficient Balance' } }, /insufficient balance \(402\)/],
    [429, { error: { message: 'Rate limit' } }, /rate limit reached \(429\)/],
  ])('maps HTTP %d to a readable error', async (status, body, pattern) => {
    const { fetch } = fakeFetch(json(body, status));
    await expect(chat(MESSAGES, { ...BASE, fetch })).rejects.toThrow(pattern);
  });

  it('explains a non-JSON 200 body (e.g. a proxy HTML page)', async () => {
    const { fetch } = fakeFetch(new Response('<html>login</html>', { status: 200 }));
    await expect(chat(MESSAGES, { ...BASE, fetch })).rejects.toThrow(/non-JSON response: <html>login/);
  });

  it('surfaces an error object carried in a 200 response', async () => {
    const { fetch } = fakeFetch(json({ error: { message: 'model not found' } }));
    await expect(chat(MESSAGES, { ...BASE, fetch })).rejects.toThrow(/returned an error: model not found/);
  });

  it('distinguishes an empty answer from one cut off before any output', async () => {
    const empty = fakeFetch(json({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }));
    await expect(chat(MESSAGES, { ...BASE, fetch: empty.fetch })).rejects.toThrow(/empty response/);

    const cut = fakeFetch(json({ choices: [{ message: { content: null }, finish_reason: 'length' }] }));
    await expect(chat(MESSAGES, { ...BASE, fetch: cut.fetch })).rejects.toThrow(/output length limit/);

    const none = fakeFetch(json({ choices: [] }));
    await expect(chat(MESSAGES, { ...BASE, fetch: none.fetch })).rejects.toThrow(/empty response/);
  });

  const CALL = { id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"query":"q"}' } };

  it('returns the tool calls of a turn that has no text', async () => {
    const { fetch } = fakeFetch(
      json({ choices: [{ message: { content: null, tool_calls: [CALL] }, finish_reason: 'tool_calls' }] }),
    );
    await expect(chat(MESSAGES, { ...BASE, fetch })).resolves.toEqual({
      content: '',
      finishReason: 'tool_calls',
      toolCalls: [CALL],
    });
  });

  it('keeps text written alongside tool calls and omits toolCalls when there are none', async () => {
    const both = fakeFetch(
      json({ choices: [{ message: { content: 'Checking.', tool_calls: [CALL] }, finish_reason: 'tool_calls' }] }),
    );
    await expect(chat(MESSAGES, { ...BASE, fetch: both.fetch })).resolves.toMatchObject({
      content: 'Checking.',
      toolCalls: [CALL],
    });
    const { fetch } = fakeFetch(ok('plain'));
    await expect(chat(MESSAGES, { ...BASE, fetch })).resolves.not.toHaveProperty('toolCalls');
  });

  // A malformed entry cannot be answered — the API needs its id back — so it is
  // dropped; a turn left with nothing usable is still an empty response.
  it('drops malformed tool calls; an empty or all-malformed list is still an empty response', async () => {
    const bad = [{ id: 1, function: CALL.function }, { id: 'x', function: { name: 'n' } }, 'junk', null];
    const mixed = fakeFetch(json({ choices: [{ message: { content: '', tool_calls: [...bad, CALL] } }] }));
    await expect(chat(MESSAGES, { ...BASE, fetch: mixed.fetch })).resolves.toMatchObject({
      toolCalls: [CALL],
    });

    const allBad = fakeFetch(json({ choices: [{ message: { content: '', tool_calls: bad } }] }));
    await expect(chat(MESSAGES, { ...BASE, fetch: allBad.fetch })).rejects.toThrow(/empty response/);

    const none = fakeFetch(json({ choices: [{ message: { content: '', tool_calls: [] }, finish_reason: 'stop' }] }));
    await expect(chat(MESSAGES, { ...BASE, fetch: none.fetch })).rejects.toThrow(/empty response/);
  });

  // DeepSeek requires a reasoning model's thinking back in every request of a
  // tool loop, so the client has to hand it out; a chat model sends none.
  it('returns the reasoning of a tool turn, and nothing when there is none', async () => {
    const thinking = fakeFetch(
      json({ choices: [{ message: { content: null, reasoning_content: 'why', tool_calls: [CALL] }, finish_reason: 'tool_calls' }] }),
    );
    await expect(chat(MESSAGES, { ...BASE, fetch: thinking.fetch })).resolves.toEqual({
      content: '',
      finishReason: 'tool_calls',
      toolCalls: [CALL],
      reasoningContent: 'why',
    });
    const plain = fakeFetch(json({ choices: [{ message: { content: 'x', reasoning_content: '' }, finish_reason: 'stop' }] }));
    await expect(chat(MESSAGES, { ...BASE, fetch: plain.fetch })).resolves.not.toHaveProperty('reasoningContent');
  });

  it('sends tools and tool_choice in the request body', async () => {
    const tool = { type: 'function' as const, function: { name: 't', description: 'd', parameters: {} } };
    const { fetch, calls } = fakeFetch(ok('x'));
    await chat(MESSAGES, { ...BASE, tools: [tool], toolChoice: 'none', fetch });
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ tools: [tool], tool_choice: 'none' });
  });

  it('wraps network failures with the URL and a hint', async () => {
    const { fetch } = fakeFetch(new TypeError('Failed to fetch'));
    await expect(chat(MESSAGES, { ...BASE, fetch })).rejects.toThrow(
      /Could not reach https:\/\/api\.deepseek\.com\/v1\/chat\/completions: Failed to fetch\. Check your network/,
    );
  });

  it('aborts a hung request after the timeout', async () => {
    vi.useFakeTimers();
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    ) as unknown as typeof fetch;

    const pending = chat(MESSAGES, { ...BASE, timeoutMs: 30_000, fetch: hanging });
    const assertion = expect(pending).rejects.toThrow(/did not answer within 30 s/);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  // The headers can arrive and the body then stall; that is the same timeout.
  it('explains a timeout that strikes while the body is being read', async () => {
    vi.useFakeTimers();
    const stalled = ((_url: string, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      } as Response)) as unknown as typeof fetch;
    const pending = chat(MESSAGES, { ...BASE, timeoutMs: 30_000, fetch: stalled });
    const assertion = expect(pending).rejects.toThrow(/did not answer within 30 s/);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('honours an external abort signal', async () => {
    const controller = new AbortController();
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    ) as unknown as typeof fetch;

    const pending = chat(MESSAGES, { ...BASE, signal: controller.signal, fetch: hanging });
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
  });
});

describe('messages for a misconfigured endpoint or model', () => {
  const url = 'https://api.deepseek.com/v2/chat/completions';

  it('names the base URL setting when the reply is not from the API at all', () => {
    expect(describeHttpError(404, '', { url })).toBe(
      `Nothing answers at ${url} (404). Check the API Base URL setting; the default is https://api.deepseek.com/v1.`,
    );
    expect(describeHttpError(429, '<!DOCTYPE html>\n<html><title>Error - Request Blocked</title>', { url })).toMatch(
      /^DeepSeek request failed \(429\): .* answered with a web page, not an API reply\. Check the API Base URL setting/,
    );
    expect(describeHttpError(404, '{"error":{"message":"not found"}}', { url })).toBe(
      `Nothing answers at ${url} (404): not found. Check the API Base URL setting; the default is https://api.deepseek.com/v1.`,
    );
  });

  it('points at the Model setting for the message DeepSeek sends for an unknown model', () => {
    const body = '{"error":{"message":"The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-chta.","type":"invalid_request_error"}}';
    expect(describeHttpError(400, body, { model: 'deepseek-chta' })).toBe(
      'DeepSeek does not know the model "deepseek-chta" (400): The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-chta. Check the Model setting.',
    );
    expect(describeHttpError(400, '{"error":{"message":"Invalid temperature value, the valid range of temperature is [0, 2]"}}')).toBe(
      'DeepSeek rejected the request as malformed (400): Invalid temperature value, the valid range of temperature is [0, 2]',
    );
  });

  it('refuses a base URL without a scheme before sending anything', async () => {
    const { fetch, calls } = fakeFetch(ok('x'));
    await expect(chat(MESSAGES, { ...BASE, basePath: 'api.deepseek.com/v1', fetch })).rejects.toThrow(
      'The API Base URL must start with https:// — it is "api.deepseek.com/v1". Check the API Base URL setting; the default is https://api.deepseek.com/v1.',
    );
    expect(calls).toEqual([]);
  });
});
