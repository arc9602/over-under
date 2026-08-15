# 005 — Finish the token migration (Section C)

- **Status**: TODO
- **Commit**: 3df0897
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens
- **Estimated scope**: 19 files, 78 occurrences. Mechanical, but see the contrast warning.

## Problem

Commit `8a88801` made `--win`, `--resolving` and `--loss` real (they had been declared outside
`@theme inline` and generated no utilities, so nothing had ever used them). Four components were
migrated then; the rest were deliberately deferred to keep that diff reviewable.

**78 raw palette classes remain across 19 files**, so status colour is still expressed
per-component instead of centrally:

| Class | Count | Target token |
| --- | --- | --- |
| `text-emerald-400` | 32 | `text-win` |
| `text-rose-400` | 22 | `text-loss` |
| `text-amber-400` | 5 | `text-resolving` |
| `border-amber-500` | 4 | `border-resolving` |
| `bg-emerald-500` | 4 | `bg-win` |
| `bg-amber-500` | 4 | `bg-resolving` |
| `text-emerald-500` | 3 | `text-win` |
| `border-emerald-500` | 2 | `border-win` |
| `bg-rose-500` | 2 | `bg-loss` |

Files, by count: `components/bet/ResolutionPanel.tsx` (8),
`components/market/MarketResolutionPanel.tsx` (7), `components/market/BetPositionChart.tsx` (5),
`app/(app)/balances/page.tsx` (5), `components/market/OrderBook.tsx` (4),
`components/bet/BetWagerChart.tsx` (4), `components/market/PositionCard.tsx` (3),
`components/market/MarketOddsChart.tsx` (2), `components/market/MarketInviteWager.tsx` (2),
`components/market/MarketCard.tsx` (2), `components/market/CreateMarketForm.tsx` (2),
`components/bet/CreateBetForm.tsx` (2), `components/bet/BetPoolChart.tsx` (2),
`components/wallet/WalletButton.tsx` (1), `components/market/OrderTicket.tsx` (1),
`components/bet/WagerForm.tsx` (1), `components/bet/OptionWagerForm.tsx` (1),
`components/balances/BalanceCard.tsx` (1), `app/layout.tsx` (1).

## This swap is NOT appearance-neutral. Read this before starting.

The token values are:

```css
--win:       oklch(0.70 0.17 162);  /* emerald-500 */
--resolving: oklch(0.80 0.15 75);   /* amber-400  */
--loss:      oklch(0.62 0.22 22);   /* rose-500   */
```

So the shade shifts in two directions:

- `text-emerald-400` → `text-win` moves 400 to **500**: slightly darker. 32 occurrences, nearly all
  text on the near-black `--background` (`oklch(0.09 0 0)`).
- `text-rose-400` → `text-loss` moves 400 to **500**: also darker. 22 occurrences, same situation.
- `bg-amber-500` / `border-amber-500` → `resolving` moves 500 to **400**: slightly lighter. 8
  occurrences.

**One token per semantic role is the correct end state** — that is the entire point of having a
token. Do not add `--win-400` / `--win-500` variants to dodge this. But the darkening of text
colours on a dark ground is a real contrast risk, so:

**After migrating, verify contrast for the text cases.** `text-win` and `text-loss` on
`--background` must clear **4.5:1** for body text and **3:1** for large text. Compute it or measure
it in DevTools on a real rendered page. **If either fails, STOP and report the measured ratio** —
do not silently ship a contrast regression, and do not "fix" it by inventing a new token. That is a
decision for the human.

## Semantics: read before mapping blindly

In market components, emerald and rose usually mean **the YES side and the NO side**, not literally
won and lost. The token names say win/loss. The values are what they already were, so the mapping
is right, but if you hit a usage where emerald plainly does not mean "good outcome" (for example a
neutral chart series colour, or a brand accent), **do not force it into `win`** — flag it and leave
it. A wrong semantic mapping is worse than a raw class.

`app/layout.tsx:46` is `success: "!text-emerald-400"` in the Toaster config. The `!` is an
`!important` modifier that Sonner needs to beat its own styles; preserve it as `!text-win`.

## Steps

1. Work file by file, largest first. For each: read it, swap only colour classes, change nothing
   else.
2. After every few files run `npx tsc --noEmit` so a mistake surfaces near where it was made.
3. When all 19 are done, run the full verification below.
4. Compute or measure contrast for `text-win` and `text-loss` against `--background` and report the
   numbers.

## Boundaries

- **Colour classes only.** Do not restructure JSX, rename props, change spacing, or "improve"
  anything you pass. This diff must be reviewable as a pure swap.
- Do **NOT** touch `app/(app)/dashboard/page.tsx` — plan 003 owns it and may be running
  concurrently.
- Do **NOT** touch `app/page.tsx`, `app/globals.css`, `components/bet/BetCard.tsx`,
  `components/bet/SideChoice.tsx`, `components/shared/SplitBar.tsx`,
  `components/bet/BetStatusBadge.tsx`, `components/shared/EmptyState.tsx`,
  `components/bet/CountdownTimer.tsx`. All already migrated.
- Do **NOT** change any query, action, route, schema, or SQL. Presentation only.
- Do **NOT** add dependencies. Do **NOT** add a light theme.
- Chart components may pass colours to a charting layer as strings rather than classes. If a colour
  is not a Tailwind class, leave it and flag it — a CSS variable may not resolve there.

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

Then confirm the sweep is complete:

```bash
grep -rnE "(text|bg|border|ring)-(emerald|rose|amber)-[0-9]{3}" components/ app/
```

Expect **zero** matches, or only entries you explicitly flagged and explained.

**Done when:** zero raw status-palette classes remain, all three mechanical checks pass, and the
contrast ratios for `text-win` and `text-loss` on `--background` are reported as numbers.
