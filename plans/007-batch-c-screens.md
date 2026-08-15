# 007 — Batch C: the four screens nobody designed

- **Status**: C1, C2, C3 TODO. C4 gets its own plan.
- **Commit**: 07853df
- **Severity**: MEDIUM
- **Category**: Composition, per screen

Four sections, four separate agents, **strictly disjoint files**. Each section names exactly what
its agent may touch. Shared primitives (`components/ui/*`, `SplitBar`, `EmptyState`, `Skeletons`)
are **read-only for everyone** — import them, never edit them.

## The exemplar

`app/(app)/dashboard/page.tsx` already embodies the target pattern, and every screen here has the
same disease it had. **Read it first.** Specifically it demonstrates:

- Exposure stated inline in the page header, not in bordered stat tiles.
- Ranking by what needs the user, not by recency.
- Dense rows at `md:` and up, cards below.
- No eyebrow labels, no `text-[10px] uppercase tracking-wider` micro-labels.
- State-differentiated treatment: terminal items recede, items needing action lead.
- `tabular-nums` on every figure, weight and size carrying emphasis rather than `font-black`.

## Rules for every section

- **Tokens only.** `text-win` / `text-loss` / `text-resolving` / `text-primary` /
  `text-muted-foreground`. Never a raw palette class. The token migration landed in `2cca0c7`; do
  not undo any of it.
- **No `font-black`.** Batch B removed it deliberately (`07853df`). The wordmark is the only
  exception and it is not on these screens.
- Motion, if any, is CSS only using `ease-[var(--ease-out)]`. No `motion` library — it is not
  installed and must not be. Anything animated must be visible when the animation does not run.
- No new dependencies. No light theme. Dark only.
- No query, action, route, schema, or SQL changes. Presentation only. If you believe data must
  change shape, **stop and report**.
- These screens are behind Google OAuth. You **cannot** load them. Do not attempt to sign in.
  Verify by typecheck, tests, build, and reading your own diff.
- If code does not match what this plan describes (drift since `07853df`), **stop and report**.

---

## C1 — `markets` list

**Files: `app/(app)/markets/page.tsx`, `components/market/MarketCard.tsx`. Nothing else.**

This screen is the pre-redesign dashboard almost exactly. `markets/page.tsx:61-75` contains the
same two hero-metric `Card` tiles the dashboard retired, with the same
`text-[10px] uppercase tracking-wider` labels ("Trading", "At Risk"), followed by the same
`Tabs` + card-list structure.

Apply the dashboard's treatment:

- Retire both stat tiles. Exposure and count move into the header as one inline line, omitted
  entirely when there is nothing live rather than printing a zero.
- Rank markets by what needs the user: `resolving` first, then markets where the user holds a
  position, then open markets, then terminal.
- Rows at `md:` and up carrying title, position, best prices, volume, deadline, status. `MarketCard`
  stays below that breakpoint.
- Keep the tab counts. Keep every filter and status meaning exactly as it is.
- **`MarketCard` must show backing.** `markets.backing` is `'iou' | 'usdc'` and it is the most
  decision-relevant fact about a market. The invite page already surfaces it; the list does not.
  Use the shipped vocabulary from `components/market/CreateMarketForm.tsx` verbatim.

## C2 — `bets/[betId]` detail

**Files: `app/(app)/bets/[betId]/page.tsx`, `components/bet/BetDetail.tsx`. Nothing else.**
Do **not** touch `WagerForm`, `OptionWagerForm`, `ResolutionPanel`, or `InviteSharePanel` — import
and place them, never edit them.

`BetDetail.tsx` is 194 lines and is the largest single component in the product. The page file is a
thin wrapper; the composition lives in the component.

The user arriving here is asking three things in order: **what was bet, where do I stand, and what
happens next.** Compose to answer them in that order.

- The proposition leads. The bet title is the largest thing on screen.
- The user's own position comes second, stated plainly: their side, their stake, and what it becomes
  if they are right. Payouts are **pari-mutuel** — any projected return is an estimate that moves as
  people join and must read that way. Never present it as fixed.
- What happens next is third: the deadline, or the resolution state, or the action the user can take.
- Everything else recedes.
- Terminal bets are records, not opportunities: resolved and cancelled states must visibly quiet
  down the way `BetCard` now does.

## C3 — `balances` / Portfolio

**Files: `app/(app)/balances/page.tsx`, `components/balances/BalanceCard.tsx`. Nothing else.**
`components/charts/Sparkline.tsx` is read-only.

Currently card-stacking: `Card > CardContent` wrappers around a `text-3xl` net figure, a sparkline,
and a two-column owed/owe grid, then a list.

- The net figure is the answer to the only question this page exists to answer. It should read as
  the page's subject, not as the contents of a box. Consider removing the card around it entirely
  and letting the number and its sparkline sit on the page.
- Owed-to-you versus you-owe is the second-most important split. Keep `text-win` / `text-loss`, and
  **do not carry that distinction by colour alone** — a colourblind user must still tell them apart.
- **This page is IOU-only.** `PRODUCT.md` is explicit that the app holds nothing. Language like
  "balance", "wallet", or "funds" in the custodial sense is wrong here. These are obligations
  between people. Audit every string on the page against that and report anything you changed.

## C4 — `markets/[marketId]` and the order book — NOT IN THIS PLAN

The hardest surface in the product: `MarketDetail`, `OrderBook`, `OrderTicket`, `MyOrdersList`,
`MarketResolutionPanel`, plus the price chart. An order book has genuine conventions that a general
"make it prettier" pass will damage, and getting it wrong misrepresents money.

It gets its own design read and its own plan. **No agent should touch those files under this plan.**

---

## Verification, all sections

```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx tsc --noEmit
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npm test
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx next build
```

Then confirm you introduced nothing forbidden:

```bash
grep -rnE "font-black|(text|bg|border)-(emerald|rose|amber)-[0-9]{3}" <your files>
```

Expect zero matches.

**Report**: Done / Verified / Decisions I had to make / Flagged / Blocked. Cite `file:line` for
every claim. Earlier agents on this project reported a database trigger that exists nowhere and a
payout figure that tracing disproved — verify against files you actually read.
