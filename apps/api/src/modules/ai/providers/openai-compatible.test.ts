import { describe, expect, it } from 'vitest';
import { ProviderError, type StructuredRequest } from '../provider';
import { createOpenAiCompatibleProvider, type OpenAiCompatibleOptions } from './openai-compatible';

const request: StructuredRequest = {
  model: 'openai/gpt-oss-120b',
  system: 'Read the expense.',
  user: 'Message: """dinner 2400"""',
  jsonSchema: { type: 'object', properties: { amount: { type: 'string' } } },
  maxOutputTokens: 1024,
  timeoutMs: 8000,
};

/** A provider whose fetch records the call and answers with `answer`. */
function setup(
  answer: () => Promise<Response> | Response,
  options: Partial<OpenAiCompatibleOptions> = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const provider = createOpenAiCompatibleProvider({
    name: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1/',
    apiKey: 'test-key',
    schemaMode: 'strict',
    ...options,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return answer();
    }) as typeof fetch,
  });
  const body = () => JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
  return { provider, calls, body };
}

const completion = (content: unknown, status = 200) =>
  Response.json(
    {
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 612, completion_tokens: 88 },
    },
    { status },
  );

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('the OpenAI-compatible provider', () => {
  it('asks for strict JSON Schema output, and returns the parsed answer and usage', async () => {
    const { provider, calls, body } = setup(() => completion('{"amount":"2400"}'));

    const response = await provider.generateStructured(request);

    expect(response).toEqual({
      output: { amount: '2400' },
      usage: { inputTokens: 612, outputTokens: 88 },
    });
    expect(calls[0]!.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(calls[0]!.init.headers).toEqual({
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
    });
    expect(body()).toEqual({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: 'Read the expense.' },
        { role: 'user', content: 'Message: """dinner 2400"""' },
      ],
      temperature: 0,
      max_tokens: 1024,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'output', schema: request.jsonSchema, strict: true },
      },
    });
  });

  it('uses JSON mode with the schema in the prompt, and adds the model’s extra parameters', async () => {
    const { provider, body } = setup(() => completion('{}'), {
      schemaMode: 'json_object',
      extraParams: { reasoning_effort: 'low' },
    });

    await provider.generateStructured(request);

    const sent = body();
    expect(sent.response_format).toEqual({ type: 'json_object' });
    expect(sent.reasoning_effort).toBe('low');
    const [system] = sent.messages as { content: string }[];
    expect(system!.content).toContain('Read the expense.');
    expect(system!.content).toContain(JSON.stringify(request.jsonSchema));
  });

  it('sends images as data URLs (for receipts)', async () => {
    const { provider, body } = setup(() => completion('{}'));

    await provider.generateStructured({
      ...request,
      images: [{ mediaType: 'image/jpeg', data: new Uint8Array([0xff, 0xd8, 0xff]) }],
    });

    const [, user] = body().messages as { content: unknown }[];
    expect(user!.content).toEqual([
      { type: 'text', text: request.user },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/' } },
    ]);
  });

  it.each([
    [429, 'rate_limited'],
    [500, 'error'],
    [400, 'error'],
    [401, 'error'],
  ] as const)('maps HTTP %i to %s, without the provider’s message', async (status, kind) => {
    const { provider } = setup(() =>
      Response.json(
        { error: { message: 'secret echo of the input', type: 'some_type' } },
        { status },
      ),
    );
    const error = await failure(provider.generateStructured(request));
    expect(error.kind).toBe(kind);
    expect(error.message).toBe(`HTTP ${status} some_type`);
  });

  it('maps a timeout', async () => {
    const { provider } = setup(() => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    const error = await failure(provider.generateStructured(request));
    expect(error.kind).toBe('timeout');
  });

  it('maps a network failure to error', async () => {
    const { provider } = setup(() => {
      throw new TypeError('fetch failed');
    });
    expect((await failure(provider.generateStructured(request))).kind).toBe('error');
  });

  it.each([
    ['not JSON', completion('{"amount": 24')],
    ['no content', completion(null)],
    ['blank content', completion('  ')],
  ])('maps an answer with %s to invalid_output, keeping its usage', async (_, response) => {
    const { provider } = setup(() => response);
    const error = await failure(provider.generateStructured(request));
    expect(error.kind).toBe('invalid_output');
    expect(error.usage).toEqual({ inputTokens: 612, outputTokens: 88 });
  });

  it('maps a body that isn’t JSON to error', async () => {
    const { provider } = setup(() => new Response('<html>bad gateway</html>', { status: 502 }));
    expect((await failure(provider.generateStructured(request))).kind).toBe('error');
  });

  it('passes a timeout signal to fetch', async () => {
    const { provider, calls } = setup(() => completion('{}'));
    await provider.generateStructured(request);
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });
});
