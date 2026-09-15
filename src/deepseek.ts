export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on an assistant turn that asked for a tool to be run. */
  tool_calls?: ToolCall[];
  /**
   * The thinking a reasoning model did on that turn. DeepSeek requires it back
   * in every request that carries `tools`; without tools it is ignored.
   */
  reasoning_content?: string;
  /** Set on a `tool` message, echoing the call it answers. */
  tool_call_id?: string;
}

/** A tool offered to the model, in the OpenAI-compatible shape DeepSeek accepts. */
export interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatOptions {
  apiKey: string;
  basePath: string;
  model: string;
  temperature?: number;
  /** Abort the request after this long. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Injection point for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Tools the model may ask to have run. Omitted entirely when empty. */
  tools?: ToolSpec[];
  /**
   * `'none'` keeps the tool definitions in the request but forbids calling them,
   * which is how a model that has searched enough is made to answer. Sent only
   * together with `tools`.
   */
  toolChoice?: 'auto' | 'none' | 'required';
}

export interface ChatResult {
  content: string;
  /** `stop` normally; `length` when the answer was cut off at the output limit. */
  finishReason?: string;
  /** Tools the model wants run before it will answer. */
  toolCalls?: ToolCall[];
  /** A reasoning model's thinking, when it sent any. Never shown; echoed back in a tool loop. */
  reasoningContent?: string;
}

interface ChatCompletionResponse {
  choices?: {
    message?: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown };
    finish_reason?: string;
  }[];
  error?: { message?: string; type?: string; code?: string };
}

// deepseek-reasoner takes minutes on hard questions; anything longer than this
// is almost certainly a hung connection.
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// deepseek-reasoner ignores (and historically rejected) the sampling parameters,
// so they are only sent for the chat models.
export function isReasoner(model: string) {
  return /reason/i.test(model);
}

/** `basePath` may be `https://host`, `https://host/v1`, or the full completions URL. */
export function endpoint(basePath: string) {
  const base = basePath.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

export function describeHttpError(status: number, body: string) {
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as ChatCompletionResponse;
    detail = parsed.error?.message ?? detail;
  } catch {
    // keep the raw body
  }

  switch (status) {
    case 400:
      return `DeepSeek rejected the request as malformed (400): ${detail}`;
    case 401:
      return `Invalid DeepSeek API key (401): ${detail}`;
    case 402:
      return `DeepSeek account has insufficient balance (402): ${detail}`;
    case 422:
      return `DeepSeek rejected the request parameters (422): ${detail}`;
    case 429:
      return `DeepSeek rate limit reached (429): ${detail}`;
    case 500:
    case 502:
    case 503:
    case 504:
      return `DeepSeek is temporarily unavailable (${status}): ${detail}`;
    default:
      return `DeepSeek request failed (${status}): ${detail}`;
  }
}

/** Builds the JSON body for `/chat/completions`. Exported for tests. */
export function buildRequestBody(
  messages: ChatMessage[],
  model: string,
  temperature: number | undefined,
  tools?: ToolSpec[],
  toolChoice?: ChatOptions['toolChoice'],
): Record<string, unknown> {
  const body: Record<string, unknown> = { model, messages, stream: false };
  if (!isReasoner(model) && typeof temperature === 'number' && Number.isFinite(temperature)) {
    body.temperature = temperature;
  }
  // An empty array is not the same as no tools: some endpoints reject it.
  if (tools && tools.length > 0) {
    body.tools = tools;
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
  }
  return body;
}

function extractContent(payload: ChatCompletionResponse): ChatResult {
  if (payload.error?.message) {
    throw new Error(`DeepSeek returned an error: ${payload.error.message}`);
  }

  const choice = payload.choices?.[0];
  const raw = choice?.message?.content;
  const content = typeof raw === 'string' ? raw.trim() : '';
  const toolCalls = readToolCalls(choice?.message?.tool_calls);

  // A turn that only asks for tools carries no text, and that is not an error.
  if (!content && !toolCalls) {
    if (choice?.finish_reason === 'length') {
      throw new Error('DeepSeek hit the output length limit before producing an answer.');
    }
    throw new Error('DeepSeek returned an empty response.');
  }

  const reasoning = choice?.message?.reasoning_content;
  return {
    content,
    finishReason: choice?.finish_reason,
    ...(toolCalls ? { toolCalls } : {}),
    ...(typeof reasoning === 'string' && reasoning ? { reasoningContent: reasoning } : {}),
  };
}

function readToolCalls(value: unknown): ToolCall[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const calls = value.filter(
    (c): c is ToolCall =>
      typeof c === 'object' &&
      c !== null &&
      typeof (c as ToolCall).id === 'string' &&
      typeof (c as ToolCall).function?.name === 'string' &&
      typeof (c as ToolCall).function?.arguments === 'string',
  );
  return calls.length > 0 ? calls : undefined;
}

export async function chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResult> {
  const apiKey = options.apiKey?.trim();
  const basePath = options.basePath?.trim();
  const model = options.model?.trim();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetch ?? fetch;

  if (!apiKey) {
    throw new Error('No DeepSeek API key configured. Set it in the plugin settings.');
  }
  if (!basePath) {
    throw new Error('No API Base URL configured. Set it in the plugin settings.');
  }
  if (!model) {
    throw new Error('No model configured. Set it in the plugin settings.');
  }

  const url = endpoint(basePath);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      forwardAbort();
    } else {
      options.signal.addEventListener('abort', forwardAbort, { once: true });
    }
  }

  const explainAbort = () => {
    if (timedOut) {
      return new Error(`DeepSeek did not answer within ${Math.round(timeoutMs / 1000)} s.`);
    }
    if (controller.signal.aborted) {
      return new Error('DeepSeek request was cancelled.');
    }
    return undefined;
  };

  let response: Response;
  let text: string;
  try {
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(buildRequestBody(
          messages, model, options.temperature, options.tools, options.toolChoice,
        )),
        signal: controller.signal,
      });
    } catch (error) {
      throw (
        explainAbort() ??
        new Error(
          `Could not reach ${url}: ${(error as Error).message}. ` +
            'Check your network, the API Base URL setting, or use a proxy if requests are blocked.',
        )
      );
    }

    // The body is read under the same timeout: a stalled stream is as bad as a stalled connect.
    try {
      text = await response.text();
    } catch (error) {
      throw explainAbort() ?? new Error(`Reading the DeepSeek response failed: ${(error as Error).message}`);
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }

  if (!response.ok) {
    throw new Error(describeHttpError(response.status, text));
  }

  let payload: ChatCompletionResponse;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`DeepSeek returned a non-JSON response: ${text.slice(0, 300)}`);
  }

  return extractContent(payload);
}
