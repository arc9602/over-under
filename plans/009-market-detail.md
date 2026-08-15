# 009 — Market detail and the order book (Batch C4)

- **Status**: TODO
- **Commit**: c760afe
- **Severity**: MEDIUM
- **Category**: Composition, on the hardest screen in the product

Held out of plan 007 on purpose. An order book has real conventions, and getting them wrong here
does not just look bad, it misrepresents money.

## Read this before you touch the book

`components/market/OrderBook.tsx` carries this comment, and it is correct:

> There is no separate ask side: buying YES means matching a resting NO bid, so the cheapest YES
> available is 100c minus the best NO bid.

**This is a binary market with two complementary bid sides, not a bid/ask book.** A NO bid at 40c
*is* a YES ask at 60c. The two sides always sum to 100.

The obvious "make it look like a real exchange" move is to build a conventional ladder with asks
above, bids below, and a spread down the middle. **Do not.** There is no spread to show, and
inventing one would misrepresent the mechanism. The existing code understands its domain; preserve
that understanding and make it legible.

Better: make the mechanic **visible to users**, not just to whoever reads the source. Someone who
has used a normal exchange will look for the ask side and be confused by its absence. One plain
sentence near the book earns its place.

## The structural problem

`app/(app)/markets/[marketId]/page.tsx:46` wraps the whole screen in `max-w-lg mx-auto space-y-6`
— a 32rem single column at every width. So on a desktop the market title, price, odds chart, order
book, position card, position chart, order ticket, open orders and resolution panel are all
stacked in one narrow ribbon, and placing an order means scrolling past everything to reach the
ticket.

**Two columns from `lg:` up.** Left: title, price, chart, book. Right: the order ticket and the
user's open orders, sticky so the ticket stays reachable while the left column scrolls. Below
`lg:`, keep the current single-column stack exactly as it is — that layout is right for a phone.

The order ticket is the thing people came to use. It should never be below the fold on a desktop.

## Backing belongs here most of all

`markets.backing` is `'iou' | 'usdc'`. The invite page shows it. `MarketCard` and the markets list
now show it. **The screen where you actually place an order does not.**

That is exactly backwards: this is the moment a user commits, and whether the other side is funded
is the most decision-relevant fact available. Surface it near the price, visible without scrolling.
Use the shipped vocabulary from `components/market/CreateMarketForm.tsx` (~lines 112-150) verbatim:
IOU is "Track who owes what, no deposit needed", USDC is "Every order is backed by real funds held
in escrow". Do not invent synonyms.

## The book itself

- **Use `font-mono` for prices and quantities.** This is the one place in the entire product where
  monospace is not a costume: a price ladder has to align character-for-character down a column.
  Note that `font-mono` only started working at all this session — `--font-geist-mono` was mapped
  in `globals.css` but defined nowhere until the landing page commit wired Geist Mono. Verify it
  actually renders monospace rather than assuming.
- Retire the `text-[10px]` micro-labels ("bids" and friends), consistent with every other screen.
- Depth should be readable at a glance. Alignment and `tabular-nums` do most of the work; a subtle
  quantity bar is acceptable if it stays behind the numbers and never competes with them.
- Keep every price in whole cents, 1-99. Never a float, never outside that range.
- Preserve the empty-book handling. The file deliberately says "nothing here" once rather than
  four times, and explains why in a comment.

## Boundaries

- **Files you may touch:** `app/(app)/markets/[marketId]/page.tsx`,
  `components/market/MarketDetail.tsx`, `components/market/OrderBook.tsx`.
- Do **NOT** touch `OrderTicket.tsx`, `MyOrdersList.tsx`, `MarketResolutionPanel.tsx`,
  `PositionCard.tsx`, `MarketOddsChart.tsx`, `BetPositionChart.tsx`, or any chart component. You
  place them; you do not edit them.
- Do **NOT** change any query, action, route, schema, or SQL. If order data must change shape,
  **stop and report**.
- Tokens only, never a raw palette class. No `font-black`. No new dependencies. No light theme.
- Motion CSS-only via `ease-[var(--ease-out)]`; `motion` is not installed and must not be.
- Prices are integers 1-99 and money is pari-mutuel nowhere on this screen — markets are
  fixed-price contracts, unlike bets. Do not import pari-mutuel language here.

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

This screen is behind Google OAuth and you **cannot** load it. Do not attempt to sign in. Verify by
typecheck, tests, build, and reading your own diff. State plainly that you could not see it run.

**Done when:** the order ticket is reachable without scrolling at `lg:` and up, mobile is unchanged,
backing is visible near the price, the book aligns in monospace, the two-bid-side mechanic is
explained to users rather than only in a comment, and no conventional bid/ask spread was invented.
