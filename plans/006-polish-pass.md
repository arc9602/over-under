# 006 — Whole-app polish pass

- **Status**: Batch A TODO. Batches B and C queued.
- **Commit**: 3df0897
- **Severity**: MEDIUM (B is partly robustness, not just polish)
- **Estimated scope**: three batches, each independently reviewable

Split into three batches on purpose. A single "polish everything" change touching 30 files is
unreviewable, and this codebase has already shown that a plan's own snippet can be wrong (see
`002`'s `SplitBar` flex bug). Small batches mean a mistake is caught in the batch it was made in.

## What the survey found

- **`font-black` appears 100 times** across `components/` and `app/`. `BetCard`, the dashboard and
  the landing page were fixed; everything else still uses the heaviest available weight for
  headings, numbers, labels and body alike. When everything is heaviest, nothing is emphasized.
  Worst offenders: `CreateMarketForm` (6), `MarketInviteWager` (5), `CreateBetForm` (5),
  `PositionCard` (4), `MarketResolutionPanel` (4), `ResolutionPanel` (4), `BetInviteWager` (4).
- **Zero `error.tsx` and zero `not-found.tsx` files exist in the entire app.** A throwing server
  component (a failed Supabase query, a malformed param) currently surfaces Next's default error
  screen. For a product that handles money and obligations, that is a robustness gap, not a
  cosmetic one.
- **Only 5 `loading.tsx` files** exist across roughly 12 routes.
- Largest screens never given a design pass: `bets/[betId]` (141 lines), `balances` (136),
  `markets/[marketId]` (120), `markets` (119).

---

# BATCH A — the states that do not exist

**This batch creates new files and touches almost nothing existing, so it is safe to run alongside
other work.**

## A1. A root `app/error.tsx`

A `"use client"` error boundary. Next.js requires this file to be a Client Component and to accept
`{ error, reset }`.

Requirements:

- **Never render `error.message` raw to the user.** A Postgres or Supabase error string can leak
  schema details, and this app deliberately hardens against exactly that (see
  `017_direct_write_hardening.sql`). Show a human sentence; keep the technical detail out of the DOM.
- Offer a real recovery: a `reset()` retry button and a link to `/dashboard`.
- `error.digest` may be shown in small muted text. It is a hash Next generates for correlating with
  server logs, and it is safe.
- Match the app's visual language: dark ground, tokens only, no `font-black`.

## A2. A root `app/not-found.tsx`

Plain, calm, and useful. Says what happened and offers a way back. No humour, no large 404
typography treatment.

## A3. `app/global-error.tsx`

Catches errors in the root layout itself. This one **must render its own `<html>` and `<body>`**,
because it replaces the root layout when it fires. Keep it deliberately minimal: inline styles are
acceptable here since the layout's CSS may be exactly what failed.

## A4. Fill the `loading.tsx` gaps

Five exist. Add them where a route does real data fetching and currently has none. Reuse the
existing skeleton components in `components/shared/Skeletons.tsx` — do **not** invent a new
skeleton vocabulary, and do not use spinners. Skeletons must match the shape of the content they
stand in for.

**Do not** add a `loading.tsx` to a route that renders instantly; an unnecessary skeleton flash is
worse than none.

## Batch A boundaries

- Do **NOT** touch `app/(app)/dashboard/page.tsx` or `app/globals.css` — plan 003 owns them.
- Do **NOT** touch anything under `components/` — plan 005 owns it.
- Do **NOT** change any query, action, route handler, schema, or SQL.
- Do **NOT** add dependencies. No light theme. No hardcoded colours. No `font-black`.

## Batch A verification

```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx tsc --noEmit
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npm test
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx next build
```

Then prove the error boundary does not leak: confirm by reading your own code that `error.message`
is never rendered into the DOM, and say which line guarantees it.

`/` and `/login` are public and reachable in a browser. `/dashboard` is not; do not attempt to
sign in.

---

# BATCH B — typography discipline (queued)

Replace the 100 `font-black` usages with a real weight scale. `font-black` is reserved for at most
one element per view; headings take `font-semibold` or `font-bold`, body takes `font-normal`,
numbers take `tabular-nums` with weight carrying emphasis rather than raw heaviness.

Runs **after** plan 005 finishes, since both sweep `components/` broadly and would collide.

# BATCH C — the four untouched screens (queued)

`bets/[betId]`, `balances`, `markets/[marketId]`, `markets`. Each needs its own design read and its
own plan; `markets/[marketId]` carries the order book and is the hardest screen in the product.

Do **not** attempt these as one change. One screen, one plan, one review.
