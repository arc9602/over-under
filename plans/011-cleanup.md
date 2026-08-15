# 011 — Dead code and duplication cleanup

- **Status**: TODO
- **Commit**: 8d2d6d7
- **Severity**: LOW (hygiene) but with a HARD constraint
- **Category**: Simplification

## The invariant, above everything else

**The app must render identically after this change.** Not "close enough", not "improved along the
way". This is a refactor: same output, less code. If a change would alter a single pixel of what a
user sees, it does not belong in this pass.

That means:

- Do **NOT** adjust spacing, sizes, weights, colours, copy, or component structure.
- Do **NOT** "fix" something that looks wrong while you are in there. Report it instead.
- Do **NOT** change behaviour, ordering, or conditional logic, even where it looks redundant,
  unless you can show the two branches produce identical output.

A baseline of the compiled CSS and the public pages was captured before this work. The CSS is
`94598` bytes with md5 `b5572ec27d9ecf7e1a99167270a5b634`. After your change, a rebuilt CSS bundle
must have the **same md5**. If it differs, you changed something visual — find it and revert it.

## 1. Dead code, verified unreferenced

**`lib/mocks/chartMockData.ts` — delete the whole file (243 lines).** Nothing imports it. Grep
finds exactly one mention anywhere: a doc comment in
`components/market/MarketOddsChart.tsx:14` that points readers at it for the shape a WebSocket feed
should append. Deleting the file makes that comment a dangling reference, so **edit the comment in
the same change** to describe the shape directly rather than pointing at a file that no longer
exists. Do not delete the whole comment; the explanation it gives is useful.

**Three unused utilities**, each unreferenced across `app/`, `components/`, `lib/`, and `tests/`:

- `formatAxisTime` in `lib/utils/chartData.ts`
- `formatCompactCurrency` in `lib/utils/formatCurrency.ts`
- `formatRelativeTime` in `lib/utils/formatDate.ts`

Re-verify each is unreferenced before deleting. If a grep finds a usage this plan missed, keep it
and say so.

## 2. Do NOT delete the chain helpers

`getVaultAccountAddress` (`lib/chain/client.ts`) and `getChainId` (`lib/chain/env.ts`) also read as
unreferenced. **Leave them.** `PRODUCT.md` records that the USDC custody stack is built
infrastructure sitting behind a decision that has not been made. Those helpers are unused because
the path they serve is not switched on, not because they are dead. Removing them would cost real
work when it is.

This distinction is the whole point of the pass: unused and dead are not the same thing.

## 3. `TERMINAL_STATUSES` is defined four times

Identical arrays in four files:

- `components/bet/BetCard.tsx:27`
- `components/bet/BetDetail.tsx:30`
- `app/(app)/dashboard/page.tsx:25`
- `app/(app)/markets/page.tsx:21`

Three are typed `BetStatus[]` and the fourth `MarketStatus[]`, but the members are the same four
strings. This is a correctness risk as well as duplication: a fifth terminal status would have to be
remembered in four places, and the one that got missed would fail silently.

Hoist to a single shared definition and import it everywhere. Put it where the status types already
live so it sits beside them rather than in a new grab-bag module. If `BetStatus` and `MarketStatus`
cannot share one constant without weakening either type, export two named constants from that one
file rather than widening a type to make them fit. **Do not loosen a type to enable the
consolidation** — a shared constant is not worth a weaker type.

## 4. Ranking logic: report, do not merge

`rankBet`/`sortBets` in the dashboard and `rankMarket`/`sortMarkets` in the markets list share a
shape but operate on different row types with different position semantics. A premature generic over
both would be harder to read than the duplication.

**Look at them and make a judgement.** If a genuinely clean shared helper falls out without generic
gymnastics, do it. If it needs type parameters and a callback for every differing part, leave both
and say why in your report. Do not force it.

## Verification, in this order

```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx tsc --noEmit
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npm test
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx next build
```

All 71 tests must pass. Then the invariant check:

```bash
cat .next/static/chunks/*.css > /tmp/after.css && md5sum /tmp/after.css
```

Expect `b5572ec27d9ecf7e1a99167270a5b634`. **A different hash means you changed something visual.**
Report the hash either way; do not quietly proceed if it differs.

**Done when:** the dead file and three utilities are gone, `TERMINAL_STATUSES` has one definition,
the chain helpers are untouched, all checks pass, and the CSS hash is unchanged.
