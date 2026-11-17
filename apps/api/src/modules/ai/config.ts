import type { Env } from '../../config/env';
import { createOpenAiCompatibleProvider } from './providers/openai-compatible';
import { AI_OFF, type AiConfig, type AiProviderSetup } from './service';

type Slot = {
  provider: string;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  textModel: string | undefined;
  schemaMode: 'strict' | 'json_object';
  extraParams: Record<string, unknown> | undefined;
  dailyTokens: number | undefined;
  price: { input: number; output: number } | undefined;
};

/**
 * The AI configuration from the environment: the primary provider (Groq) and an optional
 * fallback (Cloudflare Workers AI), both OpenAI-compatible. Models, URLs and keys are environment
 * variables, so a retired model is a configuration change. No primary key: AI off.
 */
export function aiConfigFromEnv(env: Env): AiConfig {
  const slots: Slot[] = [
    {
      provider: env.AI_PRIMARY_PROVIDER,
      baseUrl: env.AI_PRIMARY_BASE_URL,
      apiKey: env.AI_PRIMARY_API_KEY,
      textModel: env.AI_PRIMARY_TEXT_MODEL,
      schemaMode: env.AI_PRIMARY_SCHEMA_MODE,
      extraParams: env.AI_PRIMARY_EXTRA_PARAMS,
      dailyTokens: env.AI_PRIMARY_DAILY_TOKENS,
      price: env.AI_PRIMARY_PRICE,
    },
    {
      provider: env.AI_FALLBACK_PROVIDER,
      baseUrl: env.AI_FALLBACK_BASE_URL,
      apiKey: env.AI_FALLBACK_API_KEY,
      textModel: env.AI_FALLBACK_TEXT_MODEL,
      schemaMode: env.AI_FALLBACK_SCHEMA_MODE,
      extraParams: env.AI_FALLBACK_EXTRA_PARAMS,
      dailyTokens: env.AI_FALLBACK_DAILY_TOKENS,
      price: env.AI_FALLBACK_PRICE,
    },
  ];
  const providers = slots.flatMap((slot): AiProviderSetup[] => {
    // The env schema requires the URL and model with a key.
    if (!slot.apiKey || !slot.baseUrl || !slot.textModel) return [];
    return [
      {
        provider: createOpenAiCompatibleProvider({
          name: slot.provider,
          baseUrl: slot.baseUrl,
          apiKey: slot.apiKey,
          schemaMode: slot.schemaMode,
          ...(slot.extraParams && { extraParams: slot.extraParams }),
        }),
        textModel: slot.textModel,
        ...(slot.dailyTokens !== undefined && { dailyTokens: slot.dailyTokens }),
        ...(slot.price !== undefined && { price: slot.price }),
      },
    ];
  });
  if (providers.length === 0) return AI_OFF;
  return {
    enabled: env.AI_ENABLED,
    providers,
    timeoutMs: env.AI_TIMEOUT_MS,
    ...(env.AI_DAILY_BUDGET_MICROS !== undefined && {
      dailyBudgetMicros: env.AI_DAILY_BUDGET_MICROS,
    }),
  };
}
