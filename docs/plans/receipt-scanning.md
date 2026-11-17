# v1.1 plan: receipt scanning and itemized splits

> Planned 2026-11-14. Not started. No receipt work happens until it is explicitly started; each phase ends with a halt and a dev log.

## Context

Splitting a restaurant or grocery bill by item is the most-requested Splitwise Pro feature. In FairShare today it takes 3–5 minutes of typing exact amounts. v1.1 adds:

1. **Scanning.** Photograph a receipt (or pick one from the gallery, which is where WhatsApp photos land), and a vision model reads it into a draft.
2. **Assigning.** The person assigns lines to people, and the app spreads tax, service charge, discounts and round-off by what each person ordered.
3. **Saving.** The expense saves through the normal create path.

Ground rules carried over from the blueprint and `ARCHITECTURE.md`:

- The AI only drafts. It never writes to the ledger.
- Money is integer minor units.
- Core is pure.
- The same input with the same ID gives identical shares (I5).

**What exists today**

- Typed entry is rules-only: `packages/core/src/parse/rules.ts`, `resolve/resolve.ts`, and `apps/web/src/features/ai/*`.
- The `ai_requests` table and the AI contracts (`packages/contracts/src/ai.ts`, including a committed JSON Schema) are in place.

**What doesn't exist yet**

- No API AI module, no `LlmProvider`, no FakeProvider, no `/ai/*` route.
- No pg-boss, no object storage client.
- No receipts, items or assignments tables.
- No architecture test for the AI boundary. The only boundary rules are ESLint `no-restricted-imports` in `packages/config/eslint.js`, and they don't cover rules between API modules.

Phase 15 wasn't built when this was written. It now comes first and builds the shared provider work (R3), so v1.1 only adds the image path.

## Provider check (Groq and Cloudflare docs, 2026-11-14)

| Question                            | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Effect on the plan                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is `qwen/qwen3.6-27b` still listed? | **No.** Groq deprecated it, with a shutdown date of 2026-09-14. The successor is **`qwen/qwen3.8-27b`** (same 131K context, vision, thinking and instruct modes, tool use, JSON mode). It is listed under **Preview**: "for evaluation… may be discontinued at short notice".                                                                                                                                                                                                                     | Primary model is `qwen/qwen3.8-27b`, set by an environment variable. The retirement we planned for has already happened once.                                                                                                                                                                            |
| Image limits                        | 20 MB maximum request with images (larger returns 400). **3 images per request** on Qwen 3.8. Base64 data URLs are supported for local images. Each image counts as **2,048 input tokens** on the model page; the vision page says "up to 1,026", so budget 2,048.                                                                                                                                                                                                                                | Send one base64 JPEG of about 1,600px (roughly 0.3–0.7 MB). Multi-page receipts can come later, up to 3 images.                                                                                                                                                                                          |
| Structured output                   | The model card lists **JSON Schema mode**. The structured-outputs page lists qwen3.8-27b under "strict mode", but a comparison table on the same page names only GPT-OSS.                                                                                                                                                                                                                                                                                                                         | Phase R0 tests `json_schema` with `strict: true`. If rejected, the code uses `json_object` with the schema in the prompt. zod validation runs either way.                                                                                                                                                |
| Free-tier limits                    | The rate-limits row for qwen3.8-27b reads **30 · 1K · 8K · 200K**. The column headers weren't captured, but this is most likely 30 requests/min, 1,000 requests/day, **8K tokens/min** and **200K tokens/day**, per organisation. To confirm in the console.                                                                                                                                                                                                                                      | One scan is about 2,048 image + ~900 prompt + ~1,200 output ≈ **4.1K tokens**. That means **about 2 scans a minute** and **about 45 scans a day across all users**, before typed entry. This drives the queue (R4) and the token caps (R3).                                                              |
| Cloudflare Llama 4 Scout            | The model page says it supports vision and has a 131K context window. Parameters include `response_format` and `guided_json`. Free allowance is **10,000 neurons/day** (reset 00:00 UTC; 429 code 3036 when used up). Scout costs 24,545 neurons per million input tokens and 77,273 per million output tokens, so a scan is ≈ 170 neurons, or **about 55 scans/day**. A changelog entry says the Workers **Free plan is losing access to some resource-intensive models**; the list was cut off. | R0 must confirm three things: Scout is still on the free plan; the image message format (data URL in `image_url`) works on the OpenAI-compatible endpoint; and `json_schema` or `guided_json` works. If Scout is gated, the fallback switches off in config and the chain goes straight to manual entry. |

Sources: [Groq vision](https://console.groq.com/docs/vision) · [Qwen 3.8 27B](https://console.groq.com/docs/model/qwen/qwen3.8-27b) · [Groq deprecations](https://console.groq.com/docs/deprecations) · [Groq models](https://console.groq.com/docs/models) · [Groq structured outputs](https://console.groq.com/docs/structured-outputs) · [Groq rate limits](https://console.groq.com/docs/rate-limits) · [Workers AI Scout](https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/) · [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/) · [Workers AI changelog](https://developers.cloudflare.com/workers-ai/changelog/)

## Key decisions (recommendation, then trade-off)

### 1. Itemized splits: add `split_method = 'itemized'`, and keep the itemized input in `split_input` with no item tables

Core gets a fifth `SplitInput` variant. The server recomputes shares from the items with the transaction-ID seed, exactly as for the other methods.

**Why not "exact shares plus item rows":**

- That design has two sources of truth that can drift: item rows could give Rahul ₹600 while his share row says ₹550.
- The server would have to recompute from the items to catch drift anyway, which is just an itemized method in disguise, except the editor wouldn't know to open the Items step.

**Why `split_input` instead of `transaction_items` and `item_assignments` tables:**

- Every other method already stores its input in `split_input`.
- So idempotent replays, no-op edit detection (`canonicalSnapshot`) and "reopen exactly as entered" (`draftFromExpense`) all work unchanged.
- Edit reopens the items **byte for byte**: same lines, same order, same weights, same charges. Same seed means same paise.

**Trade-offs:**

- No relational item queries. Item analytics ("food was 42%") can add a derived table later.
- Claiming a placeholder must rewrite IDs inside the JSON. `mergePlaceholder` (`apps/api/src/modules/claims/merge.ts`) likely already has this gap for equal/exact/percent/shares inputs, because it repoints payer and share rows but not `split_input`. Phase R0 confirms it with a test and fixes it for every method.
- The nightly check validates itemized sums with JSON SQL.

This changes the blueprint's table list, so it goes in ARCHITECTURE "Plan corrections".

### 2. Processing: a pg-boss job with status polling, not a synchronous request

- **Groq's limit is per organisation.** At 8K tokens a minute, two people scanning at once would get 429s on a synchronous path. A queue with one worker smooths that instead of failing.
- **The worst case is long.** A Groq timeout plus the Cloudflare fallback can take about 35 seconds. Phones drop requests when the person switches to WhatsApp, whereas a job survives that and survives deploys.
- **pg-boss gives the rest for free:** retries with back-off, singleton keys for idempotency, cron for the purge jobs, and enqueueing inside our own transaction.
- **It's already on the roadmap.** The blueprint puts pg-boss in v1.1 behind `WORKERS_ENABLED`, and recurring expenses will need it next.
- **Fit:** one replica fits pg-boss in-process.
- **Cost:** a new dependency, the `pgboss` schema plus grants, and polling (every 1.5s, stopping after 2 minutes).

### 3. Uploads: the browser PUTs directly to R2 with a presigned URL

- **Signing:** the signature covers `Content-Type: image/jpeg` and the exact `Content-Length` the client declared, so R2 rejects anything else. The URL expires in 5 minutes. The API's 64 KB body cap stays.
- **Prefixes:** objects go to an `incoming/` prefix, which has an **R2 lifecycle rule deleting after 2 days** as a storage-level backstop. When a receipt is attached to an expense, the server copies it to `kept/` and deletes the incoming copy.
- **Trade-off:** the R2 origin must be added to `connect-src`, and the bucket needs CORS (PUT from `APP_URL` only).

### 4. Viewing photos: proxied through the API (`GET /receipts/:id/image`), not signed GET URLs

- Access is checked on every request, nothing leaks if a URL is copied, and `img-src` stays `'self'`. It only gains `blob:`, for the local preview.
- **Cost:** image bytes pass through the API. At friend scale that's negligible.

### 5. Images reach the providers as base64 data URLs, not R2 URLs

- No third party fetches from our bucket, and Groq and Cloudflare use one code path. Cloudflare needs data URLs anyway.
- **Cost:** requests are about 33% larger, still far under 20 MB.

### 6. Client image preparation: always upload a JPEG made on the device

1. Decode with `createImageBitmap(file, { imageOrientation: 'from-image' })`.
2. Resize to a longest side of 1,600px. For a **tall receipt** (aspect ratio above 2.5), allow up to 2,400px, keeping the width between 1,000 and 1,200px so thermal print stays readable.
3. Encode as JPEG at quality 0.85 through a canvas. Re-encoding drops **all EXIF, including location**. The server also strips any APP1 segment as a second safeguard.

**HEIC:** rely on the browser. iOS converts HEIC to JPEG when `accept` doesn't list HEIC. Elsewhere, a failed decode shows "This photo format can't be read here. Share it as a JPEG or take a screenshot" and offers manual entry. A WASM HEIC decoder would need `'wasm-unsafe-eval'` in the CSP and about 1 MB, so it's deferred.

### 7. How charges are allocated (core)

- **Items:** each item is split among its assignees by weight using `allocateProportional`, seeded `${txId}:item:${index}`.
- **Pools:** then three pools are each split by each person's item subtotal: charges not included in prices (all tax lines plus service charge, tip, packaging and delivery) seeded `:charges`; discounts seeded `:discounts`; and round-off, which is signed, seeded `:roundoff`.
- **Tax-inclusive lines** (MRP or "GST included") are shown but not allocated.
- **No negative shares:** no one's share can go negative, because a pool is never larger than the subtotal it's spread over.

### 8. Service charge is removable

Service charge is voluntary in India (CCPA guidelines). Its line has "Remove", which recomputes the total and shows it.

### 9. Scope

- **Where scanning lives:** inside a group's or friend's **Add expense** only, as a "Scan receipt" button beside "Type it". Not on Home.
- **Photos:** one photo per receipt.
- **Itemizing without a photo:** "Split by items" works without a photo too, as the new **Items** tab in the split sheet.

### 10. Limits

- **Per person:** 3 scans a minute (in-memory) and 10 a day (counted in the database).
- **Shared token cap:** one daily cap for each provider, set at 80% of its free daily allowance. Typed entry (Phase 15) shares it.
- **Throughput:** the worker runs one job at a time, with an in-process tokens-per-minute gate set from the provider's limit.

### 11. Retention

| What                                          | How long                                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Photo not attached to an expense              | 24 hours (purge job), with the 2-day lifecycle rule as backstop                                                                                |
| Raw model output and `ai_requests.input_text` | 30 days                                                                                                                                        |
| Photo attached to an expense                  | As long as the expense exists. If the expense is deleted, the photo goes 30 days later (a restored expense keeps its items but not the photo). |
| Account deletion                              | All photos the person uploaded are deleted at once. Items stay in the group's expenses, because they are group data.                           |

## Phases in build order

**Build order across the project:**

1. The placeholder-claim fix (done first).
2. Phase 15: typed entry with the LLM, which builds R3.
3. v1.1 receipts: R0–R8, minus R3.
4. Phase 14 (production launch), whenever you decide to go live.

Each phase follows the existing rules: no commits, halt with a summary when the phase is done, and add `docs/dev-log/v1.1-rN-<name>.md`. "Done" always includes `pnpm check` passing and the relevant e2e passing.

---

### R0 — Verify and prepare (about 1 day, no feature code)

**Tasks**

- A probe script, `apps/api/scripts/ai-probe.ts`, run by hand and never in CI. It checks each provider for: vision with one base64 JPEG; `json_schema` strict, else `json_object`; reasoning off (`reasoning_effort` or instruct mode); latency; and the token counts reported.
- Read the confirmed free limits from the Groq console and the Cloudflare dashboard, and Scout's free-plan status.
- Confirm Groq's and Cloudflare's data terms (no training, retention) for the privacy notice.
- Pick and pin library versions, recorded under Version decisions:
  - pg-boss;
  - `aws4fetch` for R2 SigV4: tiny and has no dependencies;
  - a local S3-compatible container for development and e2e (MinIO's image distribution changed in 2025, so check licensing and availability).
- Confirm that R2 presigned PUT enforces the signed `Content-Length`. If it doesn't, the HEAD check in R5 enforces it.
- **The merge gap: done** in the separate fix (`docs/dev-log/fix-claim-split-input.md`). `renameInSplit` already exists. R1 only adds the itemized case.
- You start collecting the evaluation receipts (see R6).

**Done when:** findings are recorded in the dev log, this plan's numbers are corrected, and the merge fix is in with its tests.

---

### R1 — Core and contracts: itemized splits and the receipt draft

**Core (`packages/core/src/split/`)** — new `itemized.ts`, exported from `index.ts`.

The new `SplitInput` variant, in compact form so the largest receipt fits in 64 KB:

```
{ method: 'itemized',
  people: UserId[],                                        // 1..50, unique
  items: { name: string; quantity?: string; amount: Minor; who: number[]; weights?: number[] }[],  // 1..100 items; who = indexes into people
  charges: { kind: 'tax'|'service_charge'|'tip'|'packaging'|'delivery'|'other'; label: string; amount: Minor; included: boolean }[],
  discounts: { label: string; amount: Minor }[],
  roundOff: { direction: 'up'|'down'; amount: Minor } | null }
```

Functions:

- `explainItemized(total, input, seed)` returns the per-item lines and, for each person, `{ items, charges, discounts, roundOff, total }`.
- `computeShares` gains the `'itemized'` branch.
- `reconcile(input)` returns `{ itemsTotal, charges, discounts, roundOff, computed }`.

New `DomainError` codes:

- `ITEMIZED_SUM_MISMATCH {expected, actual}`
- `ITEM_UNASSIGNED {index}`
- `INVALID_ITEM_REFERENCE`

Rules: every person must appear on at least one line, item amounts are ≥ 1, and weights are 1–1000.

**Core (`packages/core/src/parse/receipt.ts`)**

- `cleanAmount(text)` strips `₹`, `Rs.`, `INR` and spaces, then calls `tryParseMoney`. It never trusts a number from the model.
- `draftFromReceipt(extraction, { minorUnits, today, currency })` returns `{ draft, doubts }`. Doubts:
  - `AMOUNT_UNREADABLE` (per line)
  - `QTY_PRICE_MISMATCH`, computed exactly with `parseScaledDecimal`
  - `DATE_OUT_OF_RANGE`: dates are read day-first for INR receipts and must be ISO, no later than today and no more than a year old
  - `CURRENCY_MISMATCH`
  - `TOTAL_MISSING`
  - `NOT_A_RECEIPT`
  - `TOO_MANY_LINES`: more than 100 lines
- `renameInSplit` from R0 gains the itemized case.

**Contracts (`packages/contracts`)**

- `split.ts`: `SplitMethod` gains `'itemized'`, plus the strict itemized schema with the limits above.
- `transactions.ts`: `CreateExpense.receiptId?: Uuid`.
- New `receipts.ts`:
  - `ReceiptExtraction`, the LLM schema. Every money value is a **string**, round-off is `{direction, amount}` (never a signed number), and it includes `isReceipt`, `merchant`, `date`, `currency`, `items[{name, quantity, unitPrice, amount}]`, `charges[{kind, label, rate, amount, included}]`, `discounts`, `roundOff`, `subtotal`, `total` and `unreadable[]`.
  - `ReceiptStatus`: `awaiting_upload | queued | processing | ready | failed`, with `failure`: `unreadable | not_a_receipt | unavailable | budget`.
  - `CreateReceiptRequest {id, byteLength ≤ 2 MiB, width, height}`.
  - `CreateReceiptResponse {receipt, upload: {url, headers, expiresAt}}`.
  - `Receipt` (status plus the draft once it's ready).
  - `Features {receipts, typedAi}`.
- `receiptExtractionJsonSchema()` is committed to `schemas/receipt-extraction.schema.json` through the existing `toMatchFileSnapshot` pattern (`src/ai.test.ts:80`). Every object has `additionalProperties: false` and every key required, as strict mode needs.
- `errors.ts` adds `RECEIPT_NOT_UPLOADED` 409, `RECEIPT_UNAVAILABLE` 409, `RECEIPT_IMAGE_INVALID` 422, `ITEMIZED_SUM_MISMATCH` 422, `ITEM_UNASSIGNED` 422 and `INVALID_ITEM_REFERENCE` 422. `AI_RATE_LIMITED` 429 and `AI_UNAVAILABLE` 503 already exist.

**Tests**

- Unit tests: a worked Indian restaurant bill (CGST 2.5% + SGST 2.5% + 10% service charge, a discount, round-off down); a weighted line; a single person; one line shared by everyone; tax-inclusive lines; leftover paise.
- Property tests (fast-check):
  - shares sum to the total;
  - every share is ≥ 0;
  - each line's allocation sums to the line amount;
  - the result is deterministic;
  - it's independent of the order of `people` (indexes remapped);
  - each person's share is within their items plus 1 paisa per pool of the exact proportional value;
  - **edit-then-revert is stable**: input → `draftFromExpense` → `expenseBody` → identical input and shares.
- `cleanAmount` and `draftFromReceipt` fuzzed with arbitrary strings: they never throw and never produce a non-integer.
- A contracts test that the largest itemized body (100 lines × 50 people) is under 64 KB.

**Done when:** core coverage stays at its threshold, the schema snapshot is committed, and the error copy is added (in R7, because `ERROR_COPY` is in web; the type check forces it).

---

### R2 — Database

**Migration `0004_receipts.sql`**, generated by drizzle-kit from the schema:

- New table `receipts`:
  - `id uuid PK` (client UUIDv7, so create is idempotent)
  - `group_id → groups`, `uploaded_by → users`
  - `status` with a CHECK, `failure` with a CHECK, and a CHECK that `status='failed'` if and only if `failure` is set
  - `storage_key text UNIQUE NULL` (null once the image is deleted)
  - `byte_length int CHECK (1..2097152)`, `width`, `height`
  - `extraction jsonb` (required when `ready`, by CHECK)
  - `raw_output jsonb` (purged after 30 days)
  - `ai_request_id → ai_requests`
  - `created_at`, `uploaded_at`, `processed_at`, `image_deleted_at`
  - Indexes: `(uploaded_by, created_at DESC)`, and `(status, created_at)` where `storage_key IS NOT NULL`, for the purge.
- `transactions`:
  - add `receipt_id uuid UNIQUE NULL → receipts`, with `CHECK (receipt_id IS NULL OR type='expense')`;
  - the `transactions_split_method` CHECK gains `'itemized'`;
  - `transactions_source` gains `'ai_receipt'`.
- `ai_requests`: add a CHECK that `kind IN ('parse_expense','receipt')`.

**Migration `0005_receipts_access.sql`** (hand-written):

- `GRANT SELECT, INSERT, UPDATE ON receipts TO fairshare_app`. No DELETE: rows are kept with their data nulled, matching the soft-delete policy.
- `GRANT SELECT ON receipts TO fairshare_readonly`.

**Nightly invariant check (`packages/db/src/invariants.ts`)** gains:

- **I13 `itemizedSums`:** for itemized expenses, Σ items + charges not included − discounts ± round-off from `split_input` equals the amount (JSON SQL).
- **`receiptLinks`:** an attached receipt's `group_id` differs from its transaction's.

The existing I1–I3 already cover the share sums.

**Tests:** update `migrations.test.ts` (tables, CHECKs, 6 migrations), `access.test.ts` (the exact app privilege map, readonly 17 tables, sequences unchanged), and the invariant tests with seeded violations.

**Done when:** a fresh migrate and the CI drift check both pass.

---

### R3 — Shared AI provider layer: built in Phase 15

> **Built in Phase 15**, which comes first. When v1.1 starts, check that Phase 15 delivered what's listed here and add only the image path (`images` in `generateStructured`, the vision model variables and the fallback provider).
> **New module `apps/api/src/modules/ai/`**

- `provider.ts`: `LlmProvider.generateStructured({ model, system, user, jsonSchema, maxOutputTokens, timeoutMs, images? })` returns `{ output, usage }`. This is the blueprint §8.3 interface with `images` now real.
- `providers/openai-compatible.ts`: **one class for Groq and Cloudflare** (both speak `/chat/completions`), configured with `{ name, baseUrl, apiKey, model, schemaMode: 'strict'|'json_object' }`. Images go as `image_url` data URLs. It sorts errors into `timeout | rate_limited(retryAfter) | unavailable | invalid_output`.
- `providers/fake.ts`: canned outputs keyed by the image's SHA-256 or by the text, plus scripted failures.
- `chain.ts`: try the providers in order. Failing over is triggered by a timeout, 5xx, 429, or invalid output (after one repair retry). Every attempt is logged.
- `budget.ts`:
  - the per-provider daily token cap, checked against `SUM(input_tokens + output_tokens)` in `ai_requests` for today (UTC, matching both providers' resets);
  - `gate.ts` is an in-process tokens-per-minute gate.
- `log.ts`: inserts into `ai_requests` (kind, path, provider, model, `prompt_version`, tokens, `cost_micros` = 0 on the free tier, latency, outcome).

**Environment** (in `config/env.ts`, with `superRefine` pairs as for Google):

| Variables                                                                                                                                                              | Purpose                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `AI_ENABLED`                                                                                                                                                           | Master switch                                          |
| `AI_PRIMARY_BASE_URL`, `AI_PRIMARY_API_KEY`, `AI_PRIMARY_VISION_MODEL`, `AI_PRIMARY_TEXT_MODEL`, `AI_PRIMARY_SCHEMA_MODE`, `AI_PRIMARY_DAILY_TOKENS`, `AI_PRIMARY_TPM` | Groq                                                   |
| `AI_FALLBACK_BASE_URL` (includes the Cloudflare account ID), `AI_FALLBACK_API_KEY`, `AI_FALLBACK_VISION_MODEL`, `AI_FALLBACK_DAILY_TOKENS`                             | Cloudflare                                             |
| `ALLOW_FAKE_AI`                                                                                                                                                        | e2e only; refused when `SENTRY_ENVIRONMENT=production` |

If the variables are unset, the feature is off, and the server boots without them.

**Boundary**

- A new ESLint rule: `modules/ai/**` and `modules/receipts/**` must not import `modules/transactions/**`, or `transactions`, `transactionPayers` or `transactionShares` from `@fairshare/db`.
- Plus `apps/api/src/architecture.test.ts`, which scans those folders' imports and fails on a match. Both are needed because lint can be disabled inline.

**Tests:** the provider against a stub HTTP server (request shape, data URL, schema mode, error mapping); the chain (primary OK; primary invalid → fallback OK; both time out → failure); the budget cap; the gate; and the architecture test.

**Done when:** the layer is ready for both receipts and typed entry. Phase 15's `/ai/parse-expense` would only add its prompt and route.

---

### R4 — Jobs and storage

**pg-boss**

- `apps/api/src/jobs/boss.ts` starts it in `main.ts` when `WORKERS_ENABLED=true`, with `migrate: false` at runtime.
- The `pgboss` schema is created by the pre-deploy migrate step (`packages/db/src/scripts/migrate.ts`, using `MIGRATION_DATABASE_URL`), followed by grants on the `pgboss` schema to `fairshare_app`.
- On SIGTERM, `boss.stop({ graceful: true })` runs inside the existing 10-second drain.
- `enqueue(tx, queue, data, { singletonKey })` sends inside our Drizzle transaction through pg-boss's `db.executeSql` option. R0 confirms this against the pinned version.
- Queues: `receipts.extract` (local concurrency 1, retry limit 2 with back-off, expires after 3 minutes) and `receipts.delete-images`.
- Cron `maintenance.purge`, hourly:
  - unattached receipts older than 24 hours: delete the object, set `storage_key` to null and set `extraction` and `raw_output` to null;
  - null `raw_output` older than 30 days;
  - null `ai_requests.input_text` older than 30 days (the Phase 15 debt);
  - delete photos of expenses deleted more than 30 days ago.

  Every step is idempotent.

**ObjectStore** (`apps/api/src/lib/object-store.ts`)

- Methods: `presignPut({ key, contentType, contentLength, expiresIn })`, `head`, `get`, `copy`, `delete`.
- Implementations: `R2ObjectStore` (aws4fetch), which also works with the local S3 container, and `MemoryObjectStore` for tests.
- Environment: `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_UPLOAD_ORIGIN` (used in the CSP).
- `docker-compose` gains the S3 container, and `pnpm db:up` creates the bucket and its CORS.

**`apps/api/src/lib/jpeg.ts`** is a small pure helper. It checks the magic bytes (`FF D8 FF`), reads the dimensions from SOF, and removes APP1/Exif segments.

**Tests:** pg-boss in integration tests (enqueue rolled back with the transaction, so no job; job runs once under the singleton key), the purge job, the store against the container in one integration test, and `jpeg.ts` on fixture files (one with GPS EXIF).

**Done when:** `WORKERS_ENABLED=false` changes nothing, and `true` runs the jobs locally.

---

### R5 — Receipts API and processing

**New module `apps/api/src/modules/receipts/`** (`routes`, `service`, `repo`, `jobs.ts`, `prompts/receipt.v1.ts`).

| Route                                   | Who                                                              | Response                                                | Notes                                                                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/features`                  | signed in                                                        | 200 `{receipts, typedAi}`                               | Lets the web app hide Scan when the feature is off                                                                                                                                                     |
| `POST /api/v1/groups/:groupId/receipts` | active member                                                    | 201 (200 on replay)                                     | Creates `awaiting_upload` and returns the presigned PUT. Limits: 3/min in memory, 10/day in the database (`AI_RATE_LIMITED`). Returns `AI_UNAVAILABLE` when AI or storage is off, or the cap is spent. |
| `POST /api/v1/receipts/:id/scan`        | uploader                                                         | 202 (200 if already queued or done)                     | HEAD the object (size and type match, else `RECEIPT_NOT_UPLOADED`); set `queued` and enqueue in one transaction                                                                                        |
| `GET /api/v1/receipts/:id`              | uploader while unattached; any active group member once attached | 200                                                     | Status, failure and the draft                                                                                                                                                                          |
| `GET /api/v1/receipts/:id/image`        | same as above                                                    | 200 `image/jpeg`, `Cache-Control: private, max-age=300` | 404 once the image is deleted                                                                                                                                                                          |
| `DELETE /api/v1/receipts/:id`           | uploader                                                         | 204                                                     | Discard an unattached receipt (the photo is deleted now). `RECEIPT_UNAVAILABLE` if attached.                                                                                                           |

Others get 404 everywhere, matching how `requireMembership` and `/transactions/:id` behave.

**Job handler `receipts.extract`** (idempotent):

1. Lock the receipt row. Skip it unless it's `queued` or retrying `processing`.
2. Set `processing`.
3. Fetch the bytes, strip EXIF, and encode as base64.
4. Run the chain (Groq, then Cloudflare) with `receipt.v1`:
   - **System prompt:** extract exactly what is printed; give amounts as printed strings; never compute or invent; mark tax-inclusive lines; treat Indian CGST/SGST/IGST/cess, service charge, packaging and round-off as charges; give dates day-first; set `isReceipt=false` for anything else.
   - **No user data is sent:** no names, members or IDs.
5. Validate with zod. On failure, make one repair retry, then fail over.
6. Store the `extraction`, `raw_output` and `ai_request_id`, and set `ready`.
7. If every provider fails, set `failed` with `unavailable`, `unreadable`, `not_a_receipt` or `budget`. The web app then opens manual items with the photo attached, so there's never a dead end.

Provider 429s use their `Retry-After` through pg-boss retries.

**Changes to the transactions service** (`apps/api/src/modules/transactions/service.ts`):

- Create gains `checkReceipt(tx, me, receiptId, groupId)`. The receipt must be mine, `ready` or `failed`, in the same group and not attached.
- Then: `source='ai_receipt'`, `ai_request_id = receipt.ai_request_id`, `receipt_id` set, and the object copied from `incoming/` to `kept/`.
- A unique violation means a race, and returns `RECEIPT_UNAVAILABLE`.
- On edit, `receiptId` can't change.
- The itemized method flows through the existing `prepareExpense` → `computeShares` path unchanged.

**Other modules**

- `mergePlaceholder` also updates `receipts.group_id` when transactions move between direct groups.
- `deleteAccount` (`users/service.ts:67`) marks the user's receipts and enqueues `receipts.delete-images` in the same transaction. It also nulls their `ai_requests.input_text`, which was a gap.

**CSP** (`apps/api/src/http/security.ts`, now built from the environment): `connect-src 'self' https://*.sentry.io <STORAGE_UPLOAD_ORIGIN>` and `img-src 'self' blob: https://*.googleusercontent.com`. The Permissions-Policy is unchanged: `camera=()` blocks `getUserMedia`, not the file input's capture. R7 verifies that on a real phone.

**Rate-limit group:** `receiptCreatesPerUser`, wired through all 8 places listed in `compose.ts`, `app.ts`, the testing helpers and `rate-limits.test.ts`.

**Authorization matrix** (`apps/api/src/authorization.test.ts`). `freshGroup()` gains an unattached receipt owned by `member` and one attached to an expense.

| Route                                         | outsider · former · member · owner            |
| --------------------------------------------- | --------------------------------------------- |
| `GET /features`                               | 200 · 200 · 200 · 200                         |
| `POST /groups/:id/receipts`                   | 404 · 404 · 201 · 201                         |
| `POST /receipts/:id/scan` (member's receipt)  | 404 · 404 · 202 · 404                         |
| `GET /receipts/:id`, unattached               | 404 · 404 · 200 · 404                         |
| `GET /receipts/:id`, attached                 | 404 · 404 · 200 · 200                         |
| `GET /receipts/:id/image`, both cases         | as for `GET /receipts/:id`                    |
| `DELETE /receipts/:id`, unattached / attached | 404 · 404 · 204 · 404 / 404 · 404 · 409 · 404 |

Signed out is 401 everywhere.

**Integration tests** (FakeProvider and MemoryObjectStore, with the job handler run inline):

- the happy path through to `ready`;
- invalid output on the primary → the fallback succeeds (two `ai_requests` rows);
- both time out → `failed`, and saving with `receiptId` still works;
- the per-user limit → 429;
- token cap spent → 503 at scan, or `failed: budget` in the job;
- declared size doesn't match → `RECEIPT_NOT_UPLOADED`;
- an image with EXIF reaches the provider stripped;
- a job re-run is a no-op;
- attach on create (source and `ai_request_id` set), the attach race, and edit keeping the receipt;
- an itemized create where the server shares equal the core preview;
- the purge job;
- account deletion;
- merge;
- the matrix and the architecture test.

**Done when:** the API is complete behind flags, and staging can scan with real keys.

---

### R6 — Evaluation harness and release gate (before the UI, to de-risk accuracy)

**Harness** (`apps/api/eval/receipts/`): `run.ts`, `score.ts`, and `labels.schema.ts`.

**Data:** 50 real receipts, kept **outside the public repo** (a git-ignored local folder or a private bucket). Each has a hand-written expected JSON. The mix:

- 35 or more Indian: restaurants with CGST/SGST and service charge; long grocery bills; cafés; pharmacy with MRP-inclusive GST; fuel; faded thermal paper; crumpled; at an angle; WhatsApp-compressed;
- about 10 from elsewhere;
- 5 that aren't receipts.

**Scoring per receipt:** total exact to the paisa, item count exact, item amounts (multiset F1 with fuzzy name matching), charges by kind and amount, round-off, "reconciles with no edits", invented lines (an amount that isn't printed), latency and tokens. Run it with `pnpm --filter @fairshare/api eval:receipts --provider primary|fallback` by hand whenever the prompt, model or provider changes. CI runs only the scorer, against FakeProvider snapshots.

**Proposed release thresholds** (primary, on readable receipts):

| Measure                  | Threshold |
| ------------------------ | --------- |
| Total correct            | ≥ 92%     |
| Item amount F1           | ≥ 90%     |
| Item count exact         | ≥ 80%     |
| Charges correct          | ≥ 90%     |
| Reconciles without edits | ≥ 75%     |
| Invented lines           | ≤ 2%      |
| Non-receipts flagged     | 5 of 5    |
| Median latency           | ≤ 6 s     |

The fallback needs total ≥ 85% and invented lines ≤ 3%, or it's switched off. If the primary misses, iterate the prompt (`receipt.v2`, and so on) before building the UI.

**Done when:** a scored report is recorded in the dev log, and the gate passes or the prompt is fixed.

---

### R7 — Web

**Entry:** a "Scan receipt" button in `features/expenses/expense-form.tsx`, next to "Type it". It's hidden when `features.receipts` is false and disabled offline ("You're offline").

- "Take photo": `<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment">`.
- "Choose photo": the gallery.

**New feature folder `features/receipts/`**

- **`prepare-image.ts`:** decode, orient, resize (with the tall-receipt rule), encode as JPEG, and reject photos under 600px on the short side. The dimension maths is pure and unit-tested.
- **`upload.ts`:** create, then PUT through XHR for progress, then scan. Retry on network failure.
- **`use-receipt.ts`:** TanStack Query polling every 1.5s, paused offline and stopping after 2 minutes ("Taking longer than usual: keep waiting / enter items yourself").
- The receipt ID is held in the existing draft store (`features/expenses/drafts.ts`), so closing and reopening Add expense resumes.

**`items-draft.ts`** (pure, no React; mirrors `split-draft.ts`) holds:

- lines `{key, name, qtyText, amountText, who: Record<userId, weight>}`;
- charges (with `included` and removable);
- discounts and round-off;
- the total text.

It evaluates through core's `explainItemized` with seed = the expense ID, so **the preview equals what's saved**. Converters go both ways with the itemized `SplitInput`. `split-draft.ts` gains `itemized` in `SplitDraft` and the **Items** tab in `METHODS`. Switching away from Items asks "Items will be cleared" first.

**`items-sheet.tsx`** is full screen on phones and a wide dialog on desktop, using the existing `Dialog` component:

- **Header:** the photo thumbnail (tap to zoom, alt text "Receipt photo"), with merchant, date and total pre-filled into the form.
- **One row per line:**
  - inline name, quantity and amount inputs;
  - an avatar toggle row of people who can take part (`canTakePart`, so left members and deleted accounts are excluded);
  - "Everyone";
  - "Shared by…", a sheet with weights.
- **Bulk actions:** "Assign remaining to…" and "Assign by person" mode (pick a person, then tap lines). Lines can be added, deleted and reordered.
- **Charges:** each line shows its amount and "Split by what each person ordered", with a toggle for "Included in prices" and "Remove" for service charge.
- **Sticky reconciliation bar:** "Lines ₹1,240 · Receipt ₹1,250 · ₹10 to fix" with an icon and text, not colour alone. Fixes: edit a line; "Add missing line"; "Use ₹1,240 as the total"; "Add ₹10 as round-off".
- **Per-person totals:** items, plus share of charges, minus discount.
- **Save** is disabled, with the reason given, while any line is unassigned ("3 items not assigned · Next") or the lines don't reconcile.

**States**

- "Reading receipt…": `role="status"`, with a skeleton list and the photo.
- Failed: a friendly line per failure reason, then manual items with the photo.
- Offline: editing works, and Save is disabled as today.
- An itemized expense with a now-deleted person: their lines must be reassigned before saving, following the existing split-sheet rule (to confirm in the code).

**Expense page** (`routes/_authed/transactions.$id.tsx`): an "Items" section listing each line and who shared it, and the receipt photo through `/receipts/:id/image`.

**Other screens**

- **Activity and history** (`features/activity/describe.ts`): "split by items".
- **Edit:** reopens the Items step exactly.
- **Privacy notice** (`routes/privacy.tsx`):
  - A new "Receipt photos" section: what's sent (the resized photo with location removed, plus a fixed instruction; never names or emails), to whom (Groq, then Cloudflare Workers AI; storage on Cloudflare R2), and retention as in decision 11.
  - The "Typed expenses" paragraph is updated only when Phase 15 ships.
  - A unit test imports the retention constants and checks the notice states the same numbers.
- **`ERROR_COPY`:**

| Code                     | Copy                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| `RECEIPT_NOT_UPLOADED`   | "The photo didn't finish uploading. Try again."                       |
| `RECEIPT_UNAVAILABLE`    | "This receipt can't be used for this expense. Scan it again."         |
| `RECEIPT_IMAGE_INVALID`  | "That photo couldn't be used. Try a clearer photo."                   |
| `ITEMIZED_SUM_MISMATCH`  | "The items, charges and discounts don't add up to the total."         |
| `ITEM_UNASSIGNED`        | "Every item needs at least one person."                               |
| `INVALID_ITEM_REFERENCE` | "Something in the item list changed. Reopen the items and try again." |

**Accessibility**

- Avatar toggles use `aria-pressed` with the label "Rahul shares Paneer tikka".
- Inputs are labelled per line ("Amount for Paneer tikka").
- Reconciliation updates use a polite live region.
- Focus moves to the first line when the draft is ready.
- Touch targets are 44px or more.
- axe runs on the new screens.

**Tests**

- Unit: `items-draft` (assign, Everyone, weights, round trip to `SplitInput`, preview equal to core) and the polling hook.
- **e2e** (`e2e/tests/receipts.spec.ts`, desktop and Pixel 7, `ALLOW_FAKE_AI` with a synthetic fixture JPEG in `e2e/fixtures/receipts/`, with the FakeProvider keyed by its hash):
  - scan → reading → items → assign → fix a ₹10 mismatch → save → balances right → edit reopens identically → photo shown;
  - the failure path into manual items;
  - Scan disabled offline;
  - axe;
  - no CSP violations (blob preview, upload to the container's origin).
- Manual check on a real Android and iPhone: capture works under `camera=()`, and iOS converts HEIC.

**Done when:** e2e passes 100% on both sizes, axe is clean, and the photo flow is verified on two real phones.

---

### R8 — Release

- Staging:
  - R2 bucket (private, CORS for `APP_URL` PUT, lifecycle rule on `incoming/`);
  - Groq and Cloudflare keys in Railway variables, which you set yourself;
  - `WORKERS_ENABLED=true`.
- One week of real use with friends. Re-run the evaluation harness on receipts collected with consent.
- **Docs:**
  - `ARCHITECTURE.md`:
    - new sections: Receipts (flow, statuses, storage, retention), Itemized splits (algorithm, seeds, storage decision), the AI module (providers, chain, caps, logging, boundary), Jobs (pg-boss, `WORKERS_ENABLED`);
    - updated sections: CSP, the rate-limit table, I13;
    - new plan corrections: item tables replaced by `split_input`, qwen3.6 retired, merge rewrites `split_input`;
    - new version decisions.
  - `docs/operations.md`: bucket setup, CORS and lifecycle; key rotation; token-cap tuning; a model-retirement runbook (change the environment variable, run the evaluation, done); purge-job monitoring; the receipt bucket not being backed up (by design).
  - `docs/screenshots`: the capture script gains the new screens (Scan, Reading, Items, mismatch, failed, expense with items).
- **Done when:** the gate passes on staging and the docs are complete.

## Risks and how the plan handles them

| Risk                                                                                                          | Handling                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Model retirement or Preview status.** qwen3.6 has already been retired; 3.8 is Preview with "short notice". | Model IDs live in environment variables. The runbook is to change the variable and re-run the evaluation. The fallback provider and manual entry mean a retirement degrades the feature instead of breaking it.                                                                                                                                       |
| **Accuracy on Indian receipts** (faded thermal paper, CGST/SGST, MRP-inclusive tax)                           | The R6 gate runs before the UI is built. Every number is re-parsed by core. The reconciliation bar exposes any error and blocks Save until it's fixed. The person always confirms.                                                                                                                                                                    |
| **Free-tier limits** (about 2 scans a minute and about 45 a day on Groq)                                      | A queue with one worker, a tokens-per-minute gate, per-provider token caps at 80%, per-person limits, Cloudflare as overflow (about 55 a day), then manual entry. Limits are environment variables, so moving to a paid tier is a config change.                                                                                                      |
| **The free tier is withdrawn**, or Scout is gated on the Cloudflare free plan                                 | R0 checks. Each provider can be switched off independently. Manual itemizing always works without AI.                                                                                                                                                                                                                                                 |
| **Privacy**                                                                                                   | EXIF is stripped on the device and again on the server. No names or IDs are sent to providers. Unattached photos are deleted after 24 hours, with a lifecycle backstop. Photos are deleted on account deletion. Photos are proxied, never public. Evaluation receipts never go in the public repo. The notice is tested against the code's constants. |
| **Prompt injection through receipt text**                                                                     | The output is schema-bound with no tools, every number is re-parsed and reconciled, and the result is only a draft.                                                                                                                                                                                                                                   |
| **pg-boss adds operational weight** (schema, grants)                                                          | It runs in-process on one replica and is created by the migrate step. Grants are pinned by `access.test.ts`. `WORKERS_ENABLED=false` makes it inert.                                                                                                                                                                                                  |
| **Two scans per tap, or a double save**                                                                       | Client UUIDv7 IDs, singleton jobs, and a unique constraint on `transactions.receipt_id`.                                                                                                                                                                                                                                                              |

## Verification (whole feature)

- `pnpm check` (format, lint, typecheck, unit and integration tests, coverage), including the architecture test and the matrix completeness check.
- `pnpm build && pnpm test:e2e`: all specs on desktop and Pixel 7, with zero CSP violations.
- `pnpm --filter @fairshare/api eval:receipts --provider primary` and `--provider fallback` meet the R6 thresholds.
- Manual testing on staging with real receipts on an Android phone and an iPhone.
- A nightly invariant check on staging after a week of use: zero findings, including I13.

## Open questions for you

1. Are you OK with **dropping the `transaction_items` and `item_assignments` tables** in favour of `split_input`? (Decision 1)
2. **Should attached photos be kept** with the expense, or deleted once saved, keeping only the items?
3. Can you collect **50 real receipts** (35 or more Indian, plus 5 that aren't receipts) for the evaluation, stored privately?
4. **Order:** do Phase 14 (launch) first, then v1.1? And should Phase 15 reuse R3, or should R3 be done as part of Phase 15?
5. Are **WhatsApp "Share to FairShare"** (a Web Share Target, which needs `injectManifest`) and **multi-photo receipts** later work, or wanted in v1.1?
