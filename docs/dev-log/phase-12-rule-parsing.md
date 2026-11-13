# Phase 12: Rule-based text entry

- **Dates:** 2026-11-13 (code part)
- **Status:** In progress. The code is done and verified locally (unit, component, end-to-end,
  Docker image). It goes live with the next push; then check it on staging (see "Lined up next").
- **Plan reference:** Implementation blueprint §8.1 (flow), §8.2 (rule-based parser), §8.6 (name
  resolution, group selection), §8.7 (ambiguous and unknown names), §8.8 (fallback), §7.3 (the bar
  in Add expense), §7.2 (Home's entry bar), C7, §10.2, §11 Phase 12

## Goal

Instant, free natural-language entry for simple sentences: "Dinner 2400 with Rahul & Amit" fills
the expense form, with nothing guessed, before any LLM is involved.

## What was built

### Core

- **`parse/rules.ts` (`parseRules`):** a sentence into an amount, description, date, payer and the
  people sharing it, with a confidence.
  - Amounts: `₹2,400`, `rs 2400`, `Rs. 2400`, `2400rs`, `INR 2400`, `2.4k`, `.5`, Indian
    grouping. They are read in the currency's own decimals; "k" is exact (three more decimal
    places). An amount named in another currency isn't used.
  - People: "with A, B and C", "between A & B", "among A + B", "with everyone / all / the group",
    and bare member names ("2400 dinner pranav rahul"). A name runs over several words only while
    they belong to a known member ("with Rahul Sharma and Amit", but "with Rahul pizza" is Rahul).
  - Payers: "I paid", "Rahul paid", "paid by Rahul", "paid by me", "I spent". No payer: me.
  - "split equally"; "today", "yesterday" (across months and leap years).
  - The description: what's left, little words trimmed from the ends ("for dinner" → "Dinner"),
    first letter capital, typed punctuation kept ("Domino's", "A/C").
- **The confidence gate:** high only when exactly one amount is found and nothing it can't handle
  appears. Otherwise each reason is reported:
  - no amount, several, an invalid one, another currency;
  - other splits (%, only, except, half, each, shares);
  - debts and paybacks; other dates;
  - Hindi/Hinglish grammar ("ka", "ne", "diya", "sab"…);
  - several payers; "Rahul paid … with Amit" (is the person typing in it?);
  - a word before "paid" that isn't a known person ("taxi paid").
- **`resolve/resolve.ts` (`resolveName`):** a typed name to a member (Blueprint 8.6).
  - Case- and accent-insensitive ("Zoë" = "zoe").
  - In stages: the whole name; then word prefixes ("Rahul", "rah sh") or one word of the name
    ("Sharma"); then one typo for names of 5+ letters ("Priyaa").
  - "me / I / myself / maine / mujhe" are the person typing.
  - Resolved, ambiguous (with candidates) or unknown.
- **`resolve/groups.ts` (`chooseGroup`):** where a sentence typed on Home belongs.
  - The group where the most names resolve.
  - A friendship when exactly one other person is named.
  - Ties go to the latest activity, then to the group ID, so it's deterministic. With nobody named,
    the latest regular group.

### Web

- **"Type it" bar** at the top of Add expense: Enter (or Fill) reads the sentence into the form,
  and doesn't save it.
  - Filled fields are highlighted until changed.
  - A new sentence replaces what the last one filled; anything changed by hand stays.
- **Chips for names** (Blueprint 8.7):
  - "Which Rahul? [Rahul Sharma] [Rahul Kumar] [Remove]".
  - "Zara isn't in Flat. [Add as new member] [Remove]". Adding creates a placeholder in the group
    and puts them in the split. A friendship can't take new people, so it offers Remove only.
  - Save waits until no chips are left ("Answer the questions about names above to save.").
- **Not understood** (Blueprint 8.8): whatever was found (often the amount) is filled in, the
  sentence as typed becomes the description (if there isn't one), and the bar says "Couldn't fully
  understand. Please check the details." The form always opens; nothing is lost.
- **Home's bar** ("Type an expense"): the names pick the group (`chooseGroup`). That group's Add
  expense opens, or the friend's for a friendship, with the sentence already read in. The sentence
  is handed over in memory, never in the address, so it isn't in logs or history.
- `features/ai/entry.ts` (`applyEntry`, `settlePending`) holds the logic, apart from React.

## Decisions and deviations

- **No LLM yet.** The plan's flow sends low-confidence sentences to `POST /ai/parse-expense`; that
  endpoint and its provider are a later phase. Until then a low-confidence sentence fills what was
  understood and says so, which is the plan's own fallback (8.8).
- **Bare names** ("2400 dinner pranav rahul", the plan's own example) need to know who could be
  meant, so the parser takes the members' names as an input. Only exact member words count, so a
  description word is rarely taken for a name.
- **"X paid" needs X to be someone known; "paid by X" and "with X" don't.** "Taxi paid" or "Zara
  paid" before a name the group doesn't have is a doubt rather than a guess. After "paid by" or
  "with", the name is explicit, and an unknown one becomes an "isn't in the group" chip.
- **"with" includes the person typing,** as Splitwise does ("I paid for dinner with Rahul" is
  three people). When someone else paid and others are named ("Rahul paid … with Amit"), that's
  unclear, so it's low confidence.
- **Nobody named means everyone in the group,** like the form's own default.
- **Saving stays the normal create.** Rules-path entries are saved as `source: manual`; `ai_text`
  and `aiRequestId` belong to the LLM path, which records an `ai_requests` row.
- **The Home bar has no group chip to change the choice in the form.** If the guess is wrong,
  closing the form and using that group's Add expense is one step; the plan's group chip can come
  with the LLM phase, where the server picks the group too.

## Problems found and fixed

1. **A second sentence kept the first one's leftovers** (its description and date) when it didn't
   mention them. Fields still as the last sentence left them now reset first; hand edits stay.
2. **Filled amounts looked different** ("2400.00") from typed ones after leaving the field
   ("2,400.00"); they're formatted the same now.
3. **The parser's own first draft** was greedy about names ("Dinner Rahul paid" made "Dinner Rahul"
   the payer, "Rahul and Amit paid" one payer named "Rahul and Amit") and took the "A" of "A/C" for
   an article; the table tests caught each before anything used it.
4. **React StrictMode** calls state initializers twice in development. A one-time "take" of the
   Home sentence could have come back empty, so the form reads it, then clears it in an effect.

## Verification

- `pnpm check` passes.

  | Package    | Tests     |
  | ---------- | --------- |
  | core       | 382       |
  | contracts  | 286       |
  | api-client | 63        |
  | db         | 97        |
  | api        | 322       |
  | web        | 140       |
  | **Total**  | **1,290** |

- **Core** (100% lines and branches, enforced):
  - parser: 84 table-driven cases, high and low confidence (the plan asks for about 60), including
    the plan's Hinglish examples;
  - resolver: 46 cases (exact, prefix, last name, typo, ambiguous, unknown, self words, stage
    order), plus edit distance;
  - group choice: most names, friendship preference (even when it's quiet), tie-breaks, nobody
    named, no groups.
- **Web:**
  - `applyEntry` / `settlePending`: 11 tests;
  - component tests in the real form: fill and save, the highlight clearing on edit, Enter not
    saving, "Which Bilal?" blocking Save until answered, Remove, the "not understood" fallback, a
    second sentence over the first, and the Home handover.
- **Bug injection: 16 of 16 caught** (one was missed at first: the friendship-preference test gave
  the friendship the latest activity, so it won anyway; a test with a quiet friendship now catches
  it):
  - (core) unsupported words ignored; several amounts accepted; "k" ignored; an unknown payer
    trusted; lists not split on "and"; "yesterday" as today; typos from 4 letters; self words
    ignored; no friendship preference
  - (web) unclear names dropped silently; the sentence not kept when not understood; a chosen
    payer not made payer; Save not waiting for chips; Enter saving
  - (end-to-end) Home handing nothing over; an added member not refreshed into the form
- **End-to-end: 56 of 56, twice** (28 tests × desktop and phone). New:
  - the plan's "I paid 2400 for dinner with Rahul and Amit" through Save, with the saved split
    checked against the API
  - "Which Rahul?" and adding Zara as a member from her chip, then saving
  - a sentence on Home going to the group its names belong to, with "yesterday" read in
- **Docker image:** migrations run (twice), the smoke test passes, no error logs.
- **Screenshots reviewed** (phone): Home's bar, chips for an ambiguous and an unknown name, the
  "not understood" state.

## Lined up next

**To finish Phase 12:**

1. **Commit and push** (nothing is committed). There are no new settings and no migrations.
2. **Check on staging:**
   - In a group, Add expense, type "I paid 2400 for dinner with <two members>", press Enter,
     check, Save.
   - Type a name two members share, and one nobody has: answer the chips.
   - On Home, type a sentence naming people from one group: that group's form opens filled in.

**Phase 13: hardening and launch readiness** (plan §11), after your go-ahead.

**Noted for later phases:**

- **The LLM path** (`POST /ai/parse-expense`, provider, prompts, rate limits, budget): low
  confidence goes to the server instead of stopping at "please check"; the server reuses
  `parseRules`, `resolveName` and `chooseGroup`.
- **v1.1:** per-member nicknames for the resolver (Blueprint 8.6), and a group chip in the form for
  entries from Home.
