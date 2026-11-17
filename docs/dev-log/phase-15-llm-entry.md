# Phase 15: AI expense entry, LLM path

- **Dates:** 2026-11-16
- **Status:** Done. It stays off until two settings are made, both on your side
  (an AI provider key, and the nightly maintenance job). See "Before turning it on".
- **Plan reference:** §11 Phase 15; Blueprint 3 ("How natural-language entry works"), 8.1–8.9, 10.4
  ("AI"), 10.5 ("AI entry"), C7.
- **Order:** this came before Phase 14 (launch), as agreed. It also builds the shared AI layer that
  v1.1 receipts will use (`docs/plans/receipt-scanning.md`, R3), so v1.1 only adds the image path.

## Goal

A sentence the rule-based parser can't fully read ("dinner ka 2400 maine diya, sab mein barabar",
"Rahul ne petrol ke 1500 diye, sirf hum dono") is read by a model on the server. The model returns
a draft the person checks in the normal form. It never writes anything, it is never a dead end,
and it stays within free tiers.

## What was built

### Contracts (`packages/contracts/src/ai.ts`)

- **`ParsedExpense`** replaces the plan's `CreateExpense.partial()`. Its fields are `amount`,
  `description`, `occurredOn`, `payerId`, `splitMethod` and `split`, with only settled people. The
  reasons:
  - A payer line needs an amount, and sentences often name the payer without one.
  - The form must know which method was meant even when nobody in the split could be settled.
- **Name resolutions** now carry `role` (payer or participant) and `value` (that person's amount,
  percentage or shares as written). Answering a chip then fills the value in.
- The compat test ties core's `Extraction` and `DraftIssueCode` to `LlmExpenseExtraction` and
  `PARSE_ISSUE_CODES` in both directions.

### Core (`packages/core/src/parse/`)

- **`readAmount`** reads amounts as written: "2,400.50", "₹2,40,000", "Rs. 450/-", "2.4k". It
  returns null for anything else, and never throws.
- **`draftFromExtraction`** turns an extraction into a draft:
  - amounts go through `readAmount`, percentages are read as basis points, shares must be whole
    numbers (1–1,000), and names go through `resolveName`;
  - names it can't settle become resolutions;
  - anything inconsistent becomes an issue (a sum that doesn't add up, percentages that don't make
    100, a bad date, an amount in another currency).

  The people sharing the expense follow the rule-based parser: the names given, or everyone when
  the text says so or names nobody.

- **`extractionFromRules`** feeds the rule-based parser's result through the same function, so the
  server builds drafts one way.

### The AI module (`apps/api/src/modules/ai/`)

- **Provider interface** (`provider.ts`): `generateStructured`, with `images` (sent as data URLs)
  ready for receipts.
- **`providers/openai-compatible.ts`:** one client for Groq and Cloudflare Workers AI.
  - **Output mode:** strict JSON Schema output, or JSON mode with the schema in the prompt.
  - **Extra request fields** per model, such as `reasoning_effort`.
  - **Failures** map to `timeout`, `rate_limited`, `error` or `invalid_output`. A provider's error
    message is never logged, because it can echo the sentence.
- **Prompt `parse-expense.v1`:** versioned and logged with every request. It sends the sentence,
  today's date, the currency and the writer's name, and nothing else (C7). It treats the message
  as data, not instructions.
- **The service** (`service.ts`):
  1. **Rules first:** the rule-based parser runs again and is authoritative. A sentence it settles
     completely answers `path: 'rules'` with no model call.
  2. **Providers in order:** otherwise it tries each provider in turn, each with an 8-second
     timeout, and moves on after an error, a timeout, a 429 or output that fails zod.
  3. **Fallback:** if nothing valid comes back, it answers `path: 'fallback'` with what the rules
     found and the sentence as the description.
  4. **Group choice:** from Home it also picks the group from the names in the sentence.
  5. **Totals:** `draftFromModel` adds up a total from exact amounts when none was written, so the
     prompt can say "never calculate".
- **Limits:**
  - 10 model calls a minute and 100 a day per person, answered with `AI_RATE_LIMITED` and
    `Retry-After`;
  - a daily token cap per provider, kept below the free tier;
  - a daily spend budget;
  - `AI_ENABLED` as a kill switch.
- **Logging:** one `ai_requests` row per provider call: provider, model, prompt version, sentence,
  tokens, cost, latency and outcome.
- **Linking saves:** saving sends `aiRequestId`. The create path already checked it belongs to the
  person and stored `source = 'ai_text'`.
- **Configuration** (`config.ts`, `config/env.ts`): 19 `AI_*` variables, with no defaults for vendor
  keys. Without `AI_PRIMARY_API_KEY` the path is off.

### Forgetting

- **Nightly maintenance** (`packages/db/src/maintenance.ts` and a "Maintenance" job in
  `nightly.yml`): clears `input_text` after 30 days. It needs its own login in `fairshare_app`,
  because the invariant check's role can't write.
- **Account deletion** now clears the person's sentences at once.

### Web

- **"Type it" bar** (`expense-form.tsx`):
  - it shows the rules' reading instantly; if they didn't understand, it asks the server, showing
    "Reading it…";
  - it applies the answer with `applyParsed`, without overwriting anything changed by hand in the
    meantime, and drops a late answer to an older sentence;
  - it shows what the server flagged, and says "Try again in a minute" when the person is over the
    limit;
  - saving sends `aiRequestId`.
- **Chips** (`entry.ts`): unsettled names keep their typed values. Answering a chip puts that value
  in the split. A payer answered from a server read doesn't join the split.
- **Home** (`home-entry.tsx`): a sentence the rules can't read goes to the server, which picks the
  group. Its read travels with the sentence to that group's form, so it isn't read twice.

### Privacy notice

- **The "Typed expenses" section** now says what is sent, to whom (Groq; Cloudflare Workers AI if
  Groq is unavailable), what is never sent, and the 30-day retention.
- **The providers' own terms** are stated only as far as their docs go: Groq keeps abuse and
  failure logs for up to 30 days unless Zero Data Retention is on; Cloudflare keeps neither input
  nor output and doesn't train on them.
- **Account deletion** is now in the deletion list.
- **The notice's date** is now 16 November 2026.
- **A test** (`privacy-notice.test.ts`) checks the notice against the code: the retention constant,
  the default providers, and exactly what the prompt sends.

### Evaluation (`apps/api/src/modules/ai/eval/`)

- **The set:** 105 sentences, each with the draft a correct reading gives: 40 English, 35 Hinglish
  and 30 edge cases. The edge cases include an injection attempt, a typo, Indian digit grouping,
  "except", someone paying for someone else, a total missing, and an unknown name.
- **Scoring** is per field (amount, payer, people, method, values, date, unknown names), through
  `draftFromModel`, so what's scored is what the person would see.
- **The release gate:** amounts ≥ 95%, people ≥ 90%, payer ≥ 90%, split method ≥ 90%.
- **In CI** (`eval.test.ts`): the golden answers must score 100%, which checks the expectations and
  the server's reading together. Every recorded run in `snapshots/` must pass the gate.
- **By hand:** `pnpm --filter @fairshare/api eval:parse` runs the set against the configured model,
  prints the scores and records a snapshot.

## Decisions and deviations

- **Groq then Cloudflare, behind one OpenAI-compatible client**, instead of the plan's Anthropic
  provider. This is your decision: free tiers that say they don't train on inputs. Model names,
  URLs and keys are environment variables. Groq has already retired one model this autumn
  (qwen3.6-27b), so a retirement must be a configuration change.
- **The primary model is `openai/gpt-oss-120b`** with `reasoning_effort: low`: strict JSON Schema
  is documented for it on Groq, and it passed the release gate (see "Verification"). **The
  fallback is Llama 4 Scout** in JSON mode, a suggestion until `eval:parse --provider fallback`
  scores it.
- **Token caps besides the cost budget.** A free tier costs nothing until it refuses, so the plan's
  spend budget alone can't protect it. Past a provider's cap, the next one is used.
- **The end-to-end tests use a local stand-in for the provider** (`e2e/scripts/llm-stub.ts`) rather
  than a fake mode in production configuration. The real HTTP client is tested end to end, and
  there is no flag that could be left on in production.
- **The evaluation lives in `src/`** rather than the plan's `apps/api/eval/`, so typecheck, lint and
  Vitest cover it. It isn't bundled: tsup builds only `main.ts` and `migrate.ts`.
- **Two chips for one name.** A name that is both payer and participant gets one chip per role,
  labelled "(who paid)". Answering one doesn't answer the other.

## Problems found and fixed

1. **Lint and test exemption.** ESLint's AI boundary rule flagged the module's own integration
   test, which checks the expense saved from a read links back. Tests are now exempt, matching the
   architecture test, which also skips tests.
2. **A regression caught by tests.** Extending `settlePending` for split values changed two
   existing behaviours: re-choosing someone already in the split made a new object, and a
   non-equal split gained participants. The existing tests caught both, and the old behaviour is
   restored.
3. **Node's type stripping.** It needs `.ts` on relative imports, so the e2e launcher couldn't load
   the stub. Fixed with `allowImportingTsExtensions` in the e2e tsconfig.
4. **Core coverage.** It dropped below its 100% threshold:
   - an unreachable re-throw is gone, because percentages are now read without exceptions;
   - tests were added for shares over the maximum, bad percentages, leap days and month 13.
5. **A test timeout under load.** An unrelated ledger property test timed out once while every
   package's tests ran together (load average 11). Core alone runs in 1.3 seconds; the next full
   run passed.

## Verification

- **`pnpm check`:** passes. Format and lint are clean, typecheck passes, and **1,661 tests** pass:
  api 574, core 448, contracts 290, web 181, db 103, api-client 65. Coverage thresholds are met.
- **End-to-end:** `pnpm build`, then the full suite: **86 passed** (78 before, plus the 4 new typed-entry journeys on desktop and phone), accessibility scans included and with no CSP violations.
- **The AI integration tests** use fake providers:
  - the rules path, with no call and no log;
  - the LLM path, with the full log row;
  - what the model is told (C7);
  - ambiguous, unknown and valued names;
  - totals added up;
  - a save linked with `source = 'ai_text'`;
  - invalid output moving to the fallback;
  - a timeout, a 429 or an error from every provider falling back to the form;
  - the kill switch, the budget and the token cap;
  - the per-minute and daily limits;
  - group choice;
  - no groups, and someone else's group.
- **Architecture test:** every file in the AI module avoids the transactions module and tables.
- **The authorization matrix** now has `POST /api/v1/ai/parse-expense` (members only), and its
  completeness check passes.
- **The real model** (`eval:parse`, 2026-11-17: Groq, `openai/gpt-oss-120b`, prompt
  `parse-expense.v1`) passes the release gate:

  | Field        | Score | Gate |
  | ------------ | ----- | ---- |
  | Amount       | 96.2% | 95%  |
  | People       | 90.5% | 90%  |
  | Payer        | 97.1% | 90%  |
  | Split method | 97.1% | 90%  |
  | Split values | 96.2% | —    |
  | Date         | 84.6% | —    |

  Two of the 105 calls failed at the provider. They count as wrong, so the scores above include
  them. People is the closest to its gate, and dates are the weakest field (not gated). Both are
  the first things to look at in a `parse-expense.v2`. The snapshot is committed, so CI keeps
  holding this run to the gate.

## Before turning it on

1. **Groq:** create a key, turn on **Zero Data Retention**, and check the model's free tokens per
   day (docs/operations.md, section 7). Optionally, set up Cloudflare too.
2. **Score the model:** done for Groq (above). Cloudflare, if you set it up, gets its own run
   with `-- --provider fallback`.
3. **Railway:** set the `AI_*` variables (docs/deploy-staging.md).
4. **Nightly maintenance:** turn it on (docs/operations.md, section 6). The privacy notice's
   30-day promise depends on it.

## Lined up next

- **v1.1 receipts,** R0–R8 without R3, when you say. Phase 15 delivered R3's shared layer. What's
  left of it is the vision model variables and the image prompt; the provider already sends images.
- **Phase 14 (launch),** when you decide to go live.
