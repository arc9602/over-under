# 010 — Tie up the loose ends

- **Status**: TODO
- **Commit**: ce37ec3
- **Severity**: LOW (each is small; together they are the difference between finished and nearly finished)
- **Estimated scope**: 3 files

Three specific, known items. Each was flagged during earlier work and deliberately deferred because
it fell outside the plan that found it. None is speculative.

## 1. Two loading skeletons no longer match their pages

A skeleton whose shape does not match what replaces it produces a visible jump on load. That is
worse than showing nothing, because the boxes it drew turn out to have been wrong about where the
content was going. `app/(app)/balances/loading.tsx` was already updated for this reason; these two
were not.

**`app/(app)/bets/[betId]/loading.tsx`** must match the reworked `components/bet/BetDetail.tsx`,
which now leads with the proposition (title at `text-2xl sm:text-3xl`), then the user's position,
then what happens next, then the pool and charts.

**`app/(app)/markets/[marketId]/loading.tsx`** must match the reworked
`app/(app)/markets/[marketId]/page.tsx`, which is now single-column below `lg:` and a
`lg:grid-cols-[1fr_22rem]` split above it, with a sticky right column.

Read both target pages before writing either skeleton. Reuse `Skeleton` from
`components/ui/skeleton` and the composites in `components/shared/Skeletons.tsx`. Do not invent a
new skeleton vocabulary and do not use spinners.

Match **shape and rhythm**, not pixel-perfect detail. The skeleton's job is to reserve roughly the
right space in roughly the right places so nothing jumps.

## 2. `WalletButton` borrows a token that means something else

`components/wallet/WalletButton.tsx` uses `text-resolving` for its "not linked yet" nudge. That
token means *a bet or market is being resolved*. Wallet linking has nothing to do with resolution;
it borrowed the colour because amber was the only amber available.

**Do not add a new token for this.** The palette should not grow a `--pending` for one usage.

Look at what the string actually is: under the IOU model the wallet is not the shipped path at all
(see `PRODUCT.md`), so "not linked yet" is **informational, not a warning**. Amber overstates it.
Use `text-muted-foreground`, which is what an informational aside looks like everywhere else in
this app.

If reading the surrounding code convinces you it genuinely is a warning rather than an aside,
**stop and report** rather than picking a colour.

## 3. Explicitly accepted, do not change

Recorded so it stops being re-raised:

In market components the `win` / `loss` tokens carry **YES-side / NO-side** meaning rather than
literally won and lost. The values are correct and the rendering is right; only the names read
slightly off in that one context. Adding `--yes` / `--no` aliases would double the palette surface
to fix a naming nuance, and renaming the tokens would churn every file that just adopted them.
**Leave it.** This is a deliberate acceptance, not an oversight.

## Boundaries

- Files you may touch: `app/(app)/bets/[betId]/loading.tsx`,
  `app/(app)/markets/[marketId]/loading.tsx`, `components/wallet/WalletButton.tsx`.
- Do **NOT** touch `BetDetail.tsx`, the market detail page, `Skeletons.tsx`, `globals.css`, or any
  query, action, route, schema, or SQL. You read the pages to match them; you do not edit them.
- Tokens only, no raw palette classes. No `font-black`. No dependencies. No light theme.

## Verification

```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx tsc --noEmit
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npm test
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx next build
```

All 71 tests must still pass.

Both routes are behind Google OAuth and you cannot load them. Do not attempt to sign in. Verify by
reading the pages you are matching and your own diff, and say plainly that you could not watch a
skeleton render.

**Done when:** both skeletons reserve roughly the layout that replaces them, the wallet nudge no
longer borrows a resolution colour, and all three checks pass.
