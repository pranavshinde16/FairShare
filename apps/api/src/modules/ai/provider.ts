// The only place that knows an LLM provider exists (Blueprint 3.4, 8.3). Everything else sees a
// draft. Swapping vendors means another LlmProvider; nothing else changes.

export type StructuredRequest = {
  model: string;
  system: string;
  user: string;
  /** The output's JSON Schema, generated from contracts (packages/contracts/schemas). */
  jsonSchema: object;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Reserved for receipts (v1.1): sent as data URLs, never as links to our storage. */
  images?: { mediaType: string; data: Uint8Array }[];
};

export type StructuredResponse = {
  /** The parsed JSON the model returned, not yet validated. */
  output: unknown;
  usage: { inputTokens: number; outputTokens: number };
};

export interface LlmProvider {
  /** Logged with each request, e.g. "groq". */
  readonly name: string;
  generateStructured(request: StructuredRequest): Promise<StructuredResponse>;
}

/** Why a provider call failed, as ai_requests records it. */
export type FailureKind = 'timeout' | 'rate_limited' | 'error' | 'invalid_output';

export class ProviderError extends Error {
  override readonly name = 'ProviderError';

  constructor(
    readonly kind: FailureKind,
    message: string,
    /** Tokens the provider reported for a failed call (an invalid answer still costs them). */
    readonly usage?: StructuredResponse['usage'],
  ) {
    super(message);
  }
}
