// Typed entry on the server (Blueprint 8.1, 8.6, 8.8, 8.9): POST /ai/parse-expense. The rule-based
// parser runs again here and is authoritative; only a sentence it can't fully read goes to a model.
// Whatever happens, the answer is a draft for the form: this module never writes a transaction.

import {
  latestOccurredOn,
  LlmExpenseExtraction,
  llmExpenseExtractionJsonSchema,
  type NameResolution,
  type ParseExpenseRequest,
  type ParsePath,
  type ParseResult,
} from '@fairshare/contracts';
import {
  chooseGroup,
  draftFromExtraction,
  extractionFromRules,
  parseRules,
  type DraftContext,
  type ParsedDraft,
} from '@fairshare/core';
import type { Db } from '@fairshare/db';
import { AppError } from '../../http/errors';
import type { RateLimiter } from '../../lib/rate-limit';
import { ProviderError, type FailureKind, type LlmProvider } from './provider';
import {
  PARSE_EXPENSE_PROMPT_VERSION,
  PARSE_EXPENSE_SYSTEM,
  parseExpenseUserMessage,
} from './prompts/parse-expense.v1';
import * as repo from './repo';

export type AiProviderSetup = {
  provider: LlmProvider;
  /** The model that reads typed sentences. */
  textModel: string;
  /** Tokens per UTC day after which this provider is skipped: stays under a free tier's limit. */
  dailyTokens?: number;
  /** US dollars per million tokens, for ai_requests.cost_micros. Free tiers leave it out. */
  price?: { input: number; output: number };
};

export type AiConfig = {
  /** The kill switch: off, every sentence the rules can't read falls back without a call. */
  enabled: boolean;
  /** Tried in order; the next one only after the previous failed (Blueprint 8.8). */
  providers: AiProviderSetup[];
  /** Per provider call (Blueprint 8.8: 8 seconds). */
  timeoutMs: number;
  /** Spend per UTC day, in US dollar micros, after which no provider is called. */
  dailyBudgetMicros?: number;
};

export const AI_OFF: AiConfig = { enabled: false, providers: [], timeoutMs: 8000 };

/** LLM calls per person per day (Blueprint 8.9), counted in ai_requests over the last 24 hours. */
export const AI_CALLS_PER_USER_PER_DAY = 100;

/** Enough for the extraction of a long sentence; the schema bounds it anyway. */
const MAX_OUTPUT_TOKENS = 1024;

/** 429 AI_RATE_LIMITED, with the seconds the route sends as Retry-After. */
export class AiRateLimited extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super('AI_RATE_LIMITED', 'Too many sentences to read. Try again in a minute.');
  }
}

export type AiService = ReturnType<typeof createAiService>;

export function createAiService(
  db: Db,
  config: AiConfig,
  deps: {
    /** Per person per minute (Blueprint 8.9: 10), counted only when a model is called. */
    limiter: RateLimiter;
    clock?: () => Date;
    /** A provider failing in a way that isn't a ProviderError: a bug, worth reporting. */
    onUnexpected?: (error: unknown) => void;
  },
) {
  const clock = deps.clock ?? (() => new Date());
  const jsonSchema = llmExpenseExtractionJsonSchema();

  /** Calls the providers in order until one gives a valid extraction. Logs every call. */
  async function extract(
    me: string,
    prompt: Parameters<typeof parseExpenseUserMessage>[0],
  ): Promise<
    { requestId: number; extraction: LlmExpenseExtraction } | { requestId: number | null }
  > {
    if (!config.enabled || config.providers.length === 0) return { requestId: null };
    const now = clock();
    if (await overBudget(now)) return { requestId: null };

    const minute = deps.limiter.consume(me);
    if (!minute.allowed) throw new AiRateLimited(minute.retryAfterSeconds);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    if ((await repo.callsSince(db, me, dayAgo)) >= AI_CALLS_PER_USER_PER_DAY) {
      throw new AiRateLimited(60 * 60);
    }

    const usage = await repo.usageSince(db, startOfUtcDay(now));
    let requestId: number | null = null;
    for (const setup of config.providers) {
      const spent = usage.get(setup.provider.name)?.tokens ?? 0;
      if (setup.dailyTokens !== undefined && spent >= setup.dailyTokens) continue;

      const started = clock().getTime();
      let outcome: FailureKind | 'ok';
      let tokens = { inputTokens: 0, outputTokens: 0 };
      let extraction: LlmExpenseExtraction | null = null;
      try {
        const response = await setup.provider.generateStructured({
          model: setup.textModel,
          system: PARSE_EXPENSE_SYSTEM,
          user: parseExpenseUserMessage(prompt),
          jsonSchema,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          timeoutMs: config.timeoutMs,
        });
        tokens = response.usage;
        const parsed = LlmExpenseExtraction.safeParse(response.output);
        outcome = parsed.success ? 'ok' : 'invalid_output';
        extraction = parsed.success ? parsed.data : null;
      } catch (error) {
        if (error instanceof ProviderError) {
          outcome = error.kind;
          tokens = error.usage ?? tokens;
        } else {
          outcome = 'error';
          deps.onUnexpected?.(error);
        }
      }
      requestId = await repo.insertRequest(db, {
        userId: me,
        kind: 'parse_expense',
        path: 'llm',
        provider: setup.provider.name,
        model: setup.textModel,
        promptVersion: PARSE_EXPENSE_PROMPT_VERSION,
        inputText: prompt.text,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        costMicros: costOf(setup, tokens),
        latencyMs: Math.max(0, clock().getTime() - started),
        outcome,
      });
      if (extraction) return { requestId, extraction };
    }
    return { requestId };
  }

  async function overBudget(now: Date): Promise<boolean> {
    if (config.dailyBudgetMicros === undefined) return false;
    const usage = await repo.usageSince(db, startOfUtcDay(now));
    const spent = [...usage.values()].reduce((sum, u) => sum + u.costMicros, 0);
    return spent >= config.dailyBudgetMicros;
  }

  return {
    /**
     * Reads a typed sentence into a draft. The group is the one given, or else chosen from the
     * names in the sentence among the person's groups.
     */
    async parseExpense(me: string, input: ParseExpenseRequest): Promise<ParseResult> {
      const groups = await repo.entryGroups(db, me, input.groupId);
      if (input.groupId !== undefined && groups.length === 0) {
        throw new AppError('NOT_FOUND', 'Group not found.');
      }
      const latestDate = latestOccurredOn(input.today);
      const contextOf = (group: repo.EntryGroup): DraftContext => ({
        meId: me,
        candidates: group.candidates,
        currency: group.currency,
        minorUnits: group.minorUnits,
        latestDate,
      });
      const choose = (names: string[]): repo.EntryGroup | undefined => {
        if (input.groupId !== undefined) return groups[0];
        const id = chooseGroup(
          names,
          groups.map((g) => ({ ...g, members: g.candidates })),
          me,
        );
        return groups.find((g) => g.id === id);
      };
      const rulesFor = (group: repo.EntryGroup) =>
        parseRules({
          text: input.text,
          today: input.today,
          currency: group.currency,
          minorUnits: group.minorUnits,
          knownNames: group.candidates.map((c) => c.name),
        });

      // The names, read with every group's names known, pick the group (Blueprint 8.6).
      const everyone = groups.flatMap((g) => g.candidates);
      const first = parseRules({
        text: input.text,
        today: input.today,
        currency: 'XXX',
        minorUnits: 2,
        knownNames: everyone.map((c) => c.name),
      });
      let group = choose([
        ...(first.payer.kind === 'person' ? [first.payer.name] : []),
        ...first.people,
      ]);
      if (!group) return nothingToRead();

      const rules = rulesFor(group);
      const fromRules = draftFromExtraction(
        extractionFromRules(rules, group.minorUnits),
        contextOf(group),
      );
      const settled =
        rules.confidence === 'high' &&
        fromRules.issues.length === 0 &&
        fromRules.resolutions.every((r) => r.status === 'resolved');
      if (settled) return resultOf('rules', null, group, fromRules);

      const myName = everyone.find((c) => c.userId === me)?.name ?? '';
      const read = await extract(me, {
        text: input.text,
        today: input.today,
        currency: group.currency,
        myName,
      });
      if ('extraction' in read) {
        const { payer, people } = read.extraction;
        group =
          choose([
            ...(payer.kind === 'person' && payer.name ? [payer.name] : []),
            ...people.filter((p) => !p.isMe).map((p) => p.name),
          ]) ?? group;
        return resultOf(
          'llm',
          read.requestId,
          group,
          draftFromModel(read.extraction, contextOf(group)),
        );
      }
      // Never a dead end (Blueprint 8.8): what the rules found, with the sentence as typed as the
      // description, for the person to finish.
      return resultOf('fallback', read.requestId, group, {
        ...fromRules,
        description: input.text.replace(/\s+/g, ' ').trim().slice(0, 120),
      });
    },
  };
}

/** No group to put it in: the person has none yet. */
function nothingToRead(): ParseResult {
  return {
    requestId: null,
    path: 'fallback',
    groupId: null,
    draft: {
      amount: null,
      description: null,
      occurredOn: null,
      payerId: null,
      splitMethod: 'equal',
      split: null,
    },
    resolutions: [],
    issues: [],
  };
}

/** A model's extraction as the draft the form gets: core's reading, and a total added up if need be. */
export function draftFromModel(extraction: LlmExpenseExtraction, ctx: DraftContext): ParsedDraft {
  return completeAmount(draftFromExtraction(extraction, ctx));
}

/**
 * The model gave each person's exact amount but no total ("Rahul 600, me 400"): the total is
 * their sum, added up here rather than by the model.
 */
function completeAmount(draft: ParsedDraft): ParsedDraft {
  if (draft.amount !== null || draft.split?.method !== 'exact') return draft;
  if (draft.resolutions.some((r) => r.status !== 'resolved')) return draft;
  if (!draft.issues.every((i) => i.code === 'AMOUNT_MISSING')) return draft;
  const amount = draft.split.amounts.reduce((sum, a) => sum + a.amount, 0);
  return amount > 0 ? { ...draft, amount, issues: [] } : draft;
}

function resultOf(
  path: ParsePath,
  requestId: number | null,
  group: repo.EntryGroup,
  draft: ParsedDraft,
): ParseResult {
  return {
    requestId,
    path,
    groupId: group.id,
    draft: {
      amount: draft.amount,
      description: draft.description,
      occurredOn: draft.occurredOn,
      payerId: draft.payerId,
      splitMethod: draft.splitMethod,
      split: draft.split,
    },
    resolutions: draft.resolutions.map((r): NameResolution => {
      const named = { name: r.name, role: r.role, value: r.value };
      if (r.status === 'resolved') return { ...named, status: 'resolved', userId: r.userId };
      if (r.status === 'unknown') return { ...named, status: 'unknown' };
      return {
        ...named,
        status: 'ambiguous',
        candidates: r.candidates.flatMap((id) => group.people.get(id) ?? []),
      };
    }),
    issues: draft.issues,
  };
}

function costOf(setup: AiProviderSetup, usage: { inputTokens: number; outputTokens: number }) {
  if (!setup.price) return 0;
  // Dollars per million tokens is the same number as dollar micros per token.
  return Math.round(
    usage.inputTokens * setup.price.input + usage.outputTokens * setup.price.output,
  );
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
