import { ProviderError, type LlmProvider, type StructuredRequest } from '../provider';

export type OpenAiCompatibleOptions = {
  /** Logged with each request, e.g. "groq" or "cloudflare". */
  name: string;
  /** Up to and including the version, e.g. https://api.groq.com/openai/v1. */
  baseUrl: string;
  apiKey: string;
  /**
   * "strict": the provider enforces the JSON Schema (response_format json_schema, strict).
   * "json_object": JSON mode, with the schema in the system prompt. zod validates either way.
   */
  schemaMode: 'strict' | 'json_object';
  /** Extra request fields for this model, e.g. {"reasoning_effort":"low"}. */
  extraParams?: Record<string, unknown>;
  /** Injectable, for tests. */
  fetch?: typeof globalThis.fetch;
};

/**
 * Any provider with an OpenAI-style /chat/completions endpoint: Groq, Cloudflare Workers AI and
 * others. One request per call, no retries (the fallback chain is the retry), no tools.
 */
export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): LlmProvider {
  const fetch = options.fetch ?? globalThis.fetch;
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    name: options.name,
    async generateStructured(request: StructuredRequest) {
      const system =
        options.schemaMode === 'strict'
          ? request.system
          : `${request.system}\n\nReply with one JSON object matching this JSON Schema:\n${JSON.stringify(request.jsonSchema)}`;
      const body = {
        model: request.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent(request) },
        ],
        temperature: 0,
        max_tokens: request.maxOutputTokens,
        response_format:
          options.schemaMode === 'strict'
            ? {
                type: 'json_schema',
                json_schema: { name: 'output', schema: request.jsonSchema, strict: true },
              }
            : { type: 'json_object' },
        ...options.extraParams,
      };

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(request.timeoutMs),
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new ProviderError('timeout', `No answer within ${request.timeoutMs} ms`);
        }
        throw new ProviderError('error', `Request failed: ${errorText(error)}`);
      }

      let payload: unknown;
      try {
        payload = await res.json();
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new ProviderError('timeout', `No answer within ${request.timeoutMs} ms`);
        }
        throw new ProviderError('error', `HTTP ${res.status} with a body that isn't JSON`);
      }
      if (!res.ok) {
        // Only the status and the provider's own error type: a message can echo the input.
        const kind = res.status === 429 ? 'rate_limited' : 'error';
        throw new ProviderError(kind, `HTTP ${res.status} ${errorType(payload)}`.trim());
      }

      const usage = usageOf(payload);
      const content = contentOf(payload);
      if (content === null) {
        throw new ProviderError('invalid_output', 'The answer had no message content', usage);
      }
      try {
        return { output: JSON.parse(content) as unknown, usage };
      } catch {
        throw new ProviderError('invalid_output', 'The answer wasn’t JSON', usage);
      }
    },
  };
}

function userContent(request: StructuredRequest) {
  if (!request.images?.length) return request.user;
  return [
    { type: 'text', text: request.user },
    ...request.images.map((image) => ({
      type: 'image_url',
      image_url: {
        url: `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`,
      },
    })),
  ];
}

type ChatCompletion = {
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  error?: { type?: unknown; code?: unknown };
};

function contentOf(payload: unknown): string | null {
  const content = (payload as ChatCompletion | null)?.choices?.[0]?.message?.content;
  return typeof content === 'string' && content.trim() !== '' ? content : null;
}

function usageOf(payload: unknown) {
  const usage = (payload as ChatCompletion | null)?.usage;
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return {
    inputTokens: count(usage?.prompt_tokens),
    outputTokens: count(usage?.completion_tokens),
  };
}

function errorType(payload: unknown): string {
  const error = (payload as ChatCompletion | null)?.error;
  const value = error?.code ?? error?.type;
  return typeof value === 'string' ? value.slice(0, 60) : '';
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : 'unknown';
}
