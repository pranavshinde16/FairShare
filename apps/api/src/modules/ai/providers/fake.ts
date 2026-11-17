import { ProviderError, type LlmProvider, type StructuredRequest } from '../provider';

/** What a FakeProvider does for one request: answer, or fail as a real provider can. */
export type FakeAnswer =
  | { output: unknown; inputTokens?: number; outputTokens?: number }
  | { fail: 'timeout' | 'rate_limited' | 'error' | 'invalid_output' };

/**
 * A provider for tests (Blueprint 8.3): canned answers chosen by the request, and a record of what
 * it was asked. Never used outside tests.
 */
export function createFakeProvider(
  name: string,
  answer: (request: StructuredRequest) => FakeAnswer,
): LlmProvider & { requests: StructuredRequest[] } {
  const requests: StructuredRequest[] = [];
  return {
    name,
    requests,
    async generateStructured(request) {
      requests.push(request);
      await Promise.resolve();
      const result = answer(request);
      if ('fail' in result) throw new ProviderError(result.fail, `fake ${result.fail}`);
      return {
        output: result.output,
        usage: { inputTokens: result.inputTokens ?? 500, outputTokens: result.outputTokens ?? 100 },
      };
    },
  };
}
