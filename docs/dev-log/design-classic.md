# Design: Direction 04 "Classic" restyle

- **Dates:** 2026-11-14
- **Status:** Done on branch `design/classic` (5 commits, not yet merged to `main`).
- **Plan reference:** the design hand-off in `design/fairshare-classic/` (outside this repo):
  `DESIGN_SPEC.md` (the spec wins where it and the screens disagree), `tokens.css` and 44
  reference screens (mobile and desktop, light and dark).

## Goal

Restyle the whole web app to the approved "Classic" direction (Manrope, new light and dark
tokens, owed/owe colours, soft cards, a frosted mobile tab bar, a desktop top bar, sidebar and
right rail) while changing **presentation only**. The data model, API calls, route behaviour,
validation and business logic stay as they were, apart from the spec's §6 changes, each
confirmed before it was built.

## Phases

| Phase | Commit    | What                                                                      |
| ----- | --------- | ------------------------------------------------------------------------- |
| 0     | (plan)    | Screen-by-screen map of the spec onto the code, decisions, phase order    |
| 1     | `e65c168` | Foundations: tokens, Manrope, buttons, the one money formatter            |
| 2     | `6c6b708` | Primitives, adopted where they drop in                                    |
| 3     | `3818784` | Shells: tab bar, top bar, sidebar, FAB, page layout, the Friends tab      |
| 4     | `1eba2e9` | Every screen, after a coverage audit of every route, dialog and state     |
| 5     | `d56d228` | Visual check of every reference screen against the running app, and fixes |

## What was built

### Foundations (Phase 1)

- **Tokens:** `apps/web/src/index.css` takes `tokens.css`'s values exactly, light and dark, in
  Tailwind v4's `@theme inline`. Dark mode still follows Appearance through the `.dark` class
  (`lib/theme.ts`, `public/theme.js`). Two derived tokens were added for contrast (see below).
- **Font:** `@fontsource-variable/manrope`, imported in `main.tsx` and served from `/assets`.
- **Buttons** (`components/ui/button.tsx`): variants default, secondary, tint, soft, ghost, plain,
  destructive, destructive-ghost and link; heights 44 / 48 / 52; disabled at 45% opacity. A
  submit button is still disabled while offline.
- **Money** (`lib/money.ts`): one formatter on top of core `formatMoney`, always `en-IN` grouping
  and the currency's own decimals (`₹1,28,417.00`). `formatWholeAmount` is used only for the
  per-person tiles (§3's one exception). `lib/money-words.ts` holds the §3 wording table
  ("you're owed", "owes you", "you lent", "settled up"…), so colour is never the only cue.

### Primitives (Phase 2)

In `components/common/` and `components/ui/`:

- `MoneyLabel` (stacked or inline, words + amount), `Avatar` with a deterministic tile colour from
  the user ID (`lib/tile.ts`, FNV-1a), `GroupTile`, `IconTile`, `ListCard` with inset dividers,
  `CapsLabel`.
- `SegmentedControl` (`aria-pressed` buttons; group tabs stay links with `aria-current`),
  `FilterChips`, `DateQuickPick` (Today · Yesterday · Pick a date), `AmountInput`.
- `Dialog`: one responsive wrapper on the native `<dialog>`. A bottom sheet below `lg` and a
  centred dialog from `lg`; a `full` size that is full-screen on phones with the ✕ / title /
  action header. Focus goes to `[data-autofocus]` after `showModal`.
- `ConfirmDialog` with `notice`, `confirmDisabled` and an `icon` for the action.

### Shells (Phase 3)

- **Breakpoint:** `lg` (1024px) everywhere, replacing `md`.
- **Phones:** frosted 78px tab bar (Groups · Friends · Activity with an unread badge · Account
  with the avatar), "Add expense" FAB, large tab titles, "← Groups" back links. Create flows are
  full-screen with no tab bar.
- **Desktop:** 64px top bar (logo, Add expense, Activity bell, avatar), 264px sidebar (Home,
  Activity, Account; Groups and Friends with their balance lines and "+"), the page, and an
  optional 320px right rail through `PageLayout`. The rail is not an `<aside>`, so the sidebar
  stays the page's only complementary landmark.
- **Add expense from the shell** (`add-expense-action.ts`): a page registers its own action (its
  group's or friend's form); otherwise the shell opens "Who is it with?". The `n` key does the
  same on desktop. It is disabled until there is something to open.
- **New route:** `/friends` (Friends tab).

### Screens (Phase 4)

A coverage audit listed every route in `routeTree.gen.ts` and every dialog, sheet, banner and
empty, error and loading state, with the reference each follows ("tokens only" where none does).
All of them were restyled, including the screens with no reference: 404, legal pages, invite
errors, delete account, PWA banners, toasts, skeletons.

## Product changes (spec §6, each confirmed)

- **§6.1 Navigation:** four tabs, with a new Friends screen built from `/home`'s people. Adding a
  friend lives there and in the sidebar "+".
- **§6.2 Remove member:** blocked while the member's balance in the group isn't zero. The
  confirm sheet says "Vikram Singh owes ₹11,200.00 in this group, so they can't be removed yet."
  and Remove is disabled.
- **§6.3 Copy:** plurals ("1 person"), full names, and the expense history as one line per change
  ("Amount ₹18,000.00 → ₹19,500.00") on a timeline. The activity feed keeps the joined sentence.
- **§6.4 No new features:** the category button in Add expense is left out; the currency is a
  fixed prefix (a group's currency doesn't change per expense); the claims banner keeps its real
  actions ("That's me" / "Not me") rather than the mock's "View".

## Decisions and deviations

- **No vaul, no Radix Dialog, no Google Fonts.** The CSP is `default-src 'self'` with no inline
  styles. Radix Dialog and vaul inject a `<style>` (react-remove-scroll), and the end-to-end suite
  fails on any CSP violation, so the native `<dialog>` wrapper was restyled instead. The font is
  self-hosted, and `build.assetsInlineLimit: 0` stops Vite inlining the font subset as a `data:`
  URL, which the CSP also blocks.
- **Group rows' breakdown** ("Priya N. owes you ₹5,550.00", "no expenses yet") comes from each
  group's existing `GET /groups/:id/balances`, fetched per group with `useQueries` and shared with
  the group page's cache. No new endpoint.
- **Friend balances keep their meaning:** the total across every shared group and the friendship,
  not "outside any group" as the mock's footnote says. The footnote was reworded to match.
- **Desktop Add expense** shows the split editor only in the right half; the "Paid by you and
  split equally" sentence moves to the footer as a summary (it focuses the editor), and the
  per-person card is phone-only, as in `d-add-expense`.
- **Expense history renders once:** in the rail on desktop, below the split on phones, chosen
  with `useMediaQuery` (`lib/use-media-query.ts`), so its heading ID and text aren't duplicated.
- **Claims banner on desktop** sits at the top of Home's rail; on phones it stays in the column.
  When Home is empty there is no rail, and the banner stays in the column at every size.
- **Deliberately left as is:** the tag tile beside Description (the category button, §6.4);
  currency names in the browser's language; screen data that differs from the mock's sample data.

## Problems found and fixed

- **Font blocked by the CSP:** Vite inlined the font subset as a `data:` URL → `assetsInlineLimit:
0`.
- **Contrast below AA:**
  - primary on accent (4.34:1) and owe on owe-muted (4.46:1) → derived `--accent-foreground`
    (`#0d7767`) and `--owe-muted-foreground` (`#be400c`) in light mode;
  - the active tab label over the frosted bar (4.32:1) → the label uses the foreground colour; the
    tinted pill marks the active tab.
- **Dialog focus landed on Close** → `data-autofocus` on the first field.
- **Hidden duplicates in tests:** jsdom has no CSS, so phone and desktop copies of the same control
  are both "visible" there (component tests take the first); Playwright's `getByText` also matches
  hidden copies. Names were made distinct ("Exact split", "Asha's exact share", "Clear search"),
  and the history now renders once.
- **The shell's Add expense clicked before Home loaded** opened nothing → disabled until ready.
- **Split view on phones:** the editor now covers the dialog's own header (`group-has` on the
  dialog), with focus moved to its Back button and back to the sentence on Done.

## Verification

- `pnpm check` (format, lint, typecheck, unit and component tests): passing. Web: 17 files, 167
  tests.
- `pnpm --filter @fairshare/web build`: passing; the font loads from `/assets`, nothing inline.
- End-to-end (`e2e`, production build, desktop and Pixel 7, axe WCAG AA in both themes, failing on
  any CSP violation): **78 / 78 passing**.
- **Visual check (Phase 5):** every reference screen was rendered at 390×844 and 1440×900 in
  light and dark and compared side by side with the same screen in the running app (seeded with
  the screenshot capture's data), then re-captured after the fixes. Friends had no capture and got
  one (`20a-friends`).
- **E2E expectations changed** only where the redesign moved or renamed things: headings
  ("Groups"/"Home", "Account"), `/friends` for people, history lines, "split by percentages",
  "All assigned · 100%", Done before Save in the phone split view, the desktop split editor's
  "₹800.00 each · 3 people" note in place of the phone-only card.

## How to re-run the visual check

The screenshot tooling (`e2e/screenshots/`, `e2e/screenshots.config.ts`) is local and not
committed. With it in place:

```bash
pnpm db:up && pnpm build
pnpm --filter @fairshare/e2e screenshots   # docs/screenshots/<variant>/, 4 variants
```

For the reference sizes, a config with 390×844 (2×) and 1440×900 projects in light and dark was
used, and each reference HTML was screenshotted at the same sizes for side-by-side comparison.

## Lined up next

- Push `design/classic`, open the PR, let CI run, merge to `main`.
- Try it on staging on a real phone: PWA install, the tab bar's safe-area padding, the dark status
  bar.
- Phase 13 is still open in this log's table; Phase 14 (launch) follows: publish the Google OAuth
  app and remove any localhost origins from its client.
