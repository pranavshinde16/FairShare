import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env';
import { aiConfigFromEnv } from './config';
import { AI_OFF } from './service';

const base = {
  DATABASE_URL: 'postgres://fairshare:fairshare@localhost:5433/fairshare',
  AUTH_SECRET: 'a-test-secret-that-is-at-least-32-chars',
  MAILPIT_URL: 'http://localhost:8025',
};

describe('aiConfigFromEnv', () => {
  it('is off without a primary key', () => {
    expect(aiConfigFromEnv(loadEnv(base))).toBe(AI_OFF);
  });

  it('builds the primary, then the fallback, with their models, caps and prices', () => {
    const config = aiConfigFromEnv(
      loadEnv({
        ...base,
        AI_PRIMARY_BASE_URL: 'https://api.groq.com/openai/v1',
        AI_PRIMARY_API_KEY: 'k1',
        AI_PRIMARY_TEXT_MODEL: 'openai/gpt-oss-120b',
        AI_PRIMARY_DAILY_TOKENS: '160000',
        AI_FALLBACK_BASE_URL: 'https://api.cloudflare.com/client/v4/accounts/x/ai/v1',
        AI_FALLBACK_API_KEY: 'k2',
        AI_FALLBACK_TEXT_MODEL: '@cf/meta/llama-4-scout-17b-16e-instruct',
        AI_FALLBACK_PRICE: '0.27,0.85',
        AI_TIMEOUT_MS: '6000',
      }),
    );
    expect(config.enabled).toBe(true);
    expect(config.timeoutMs).toBe(6000);
    expect(config.dailyBudgetMicros).toBeUndefined();
    expect(
      config.providers.map((p) => [p.provider.name, p.textModel, p.dailyTokens, p.price]),
    ).toEqual([
      ['groq', 'openai/gpt-oss-120b', 160000, undefined],
      [
        'cloudflare',
        '@cf/meta/llama-4-scout-17b-16e-instruct',
        undefined,
        { input: 0.27, output: 0.85 },
      ],
    ]);
  });
});
