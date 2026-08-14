# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are friends betting each other on things they already argue about — sports
outcomes, personal predictions, group-chat disputes. The situation is social and the stake is
usually small; the job is to make a casual "I bet you" concrete enough that both sides remember
the terms and can settle without argument.

The same person is also the secondary user: as a group's betting gets busier, they move from a
one-off two-sided bet into a standing market with an order book, where more than two people can
take a side at a price. Both layers are first-class. The design must serve the transition
between them, not treat markets as an expert mode bolted onto the side.

## Product Purpose

Over/Under turns informal bets between friends into recorded, resolvable positions. A bet is
created with a title, sides, and a deadline; it is shared by invite link; participants take a
side; the event happens; the outcome is proposed and confirmed; the resulting obligation is
recorded and settled.

Success is that a bet made in a group chat gets resolved and settled without anyone having to
remember what was agreed or chase anyone for it.

## Positioning

Two things a neighboring product would have to copy together, not separately:

- **A private betting venue, not a public one.** Bets and markets are created by users about
  whatever they want, distributed by invite link to a specific group. There is no house, no
  listing process, and no shared public order flow with strangers.
- **One continuum from a handshake bet to a priced market.** The same product covers a two-sided
  bet between friends and a multi-participant market with limit orders and a probability price,
  using deliberately shared vocabulary (bet and market statuses use the same state names so the
  same status treatment reads on both).

## Operating Context

- **Creation** is casual and mobile — often written while the argument is still happening.
- **Distribution** is an invite link (`/bet/<inviteCode>`, `/market/<inviteCode>`) pasted into an
  existing group conversation. The link is the front door; a recipient may not have an account.
- **The waiting period** is most of a bet's life. Between placing and resolving, the surface is
  something users check, not something they operate — deadlines approach, prices move.
- **Resolution** is a two-step social act: someone proposes an outcome, someone else confirms it.
  It can be disputed or superseded. It is not an oracle and not automatic.
- **Settlement** closes the loop and is where the product's promise is either kept or lost.

Bet lifecycle: `open → active → resolving → resolved`, with `cancelled`, `expired`, and `stuck`
as real terminal or stalled states. Markets add `locked`. Resolutions carry their own status:
`pending → confirmed`, or `disputed` / `superseded`.

## Capabilities and Constraints

Confirmed functionality:

- Google OAuth sign-in; usernames and profiles.
- Two-sided bets with sides, cumulative wager limits, invite codes, countdown to deadline.
- Multi-option bets and pooled bets.
- **Payouts are pari-mutuel, not fixed-odds.** Winners split the losing pool in proportion to
  their stake, so a payout quoted before the deadline is a moving estimate, never a promise.
  Any surface showing a potential return must read as a projection that changes as others join.
  The authoritative numbers come from the `confirm_resolution` RPC; client-side figures are
  previews only.
- Prediction markets with a limit order book: orders priced 1–99 (cents of probability), partial
  fills, positions, and price history.
- Propose/confirm resolution with dispute and supersede paths.
- An IOU ledger and settle-up flow recording who owes what.
- USDC custody: linked external wallets, custodied balances, escrow locks against wagers,
  deposits credited after a confirmation threshold, and withdrawals.

Technical constraints that shape design:

- Next.js 16 App Router deployed to Cloudflare Workers via OpenNext — the wallet stack is
  deliberately kept out of the Worker bundle, so wallet UI is client-side and gated.
- Supabase Postgres with row-level security as the real authorization boundary.
- USDC amounts are integer minor units; market prices are integers 1–99. Design must never
  introduce float money or a price outside that range.
- Chain config can be absent. `isChainConfigured()` exists so the UI renders a
  "wallet not configured" state instead of crashing — that degraded state is a real state to
  design, not an error.
- Admin force-settle is disabled unless explicitly configured (fails closed).

**Money model — backing is a property of the thing being bet on, not of the app.**
(Settled by migration `016_market_backing.sql`.)

- **Bets are always IOU.** The app records what was staked and who owes whom. It holds nothing,
  moves nothing, and guarantees nothing. People settle between themselves.
- **Markets are either IOU-backed or USDC-backed, chosen once at creation and immutable
  thereafter** — the immutability has no role exemption, not even `service_role`. An IOU market
  settles to `iou_ledger` with nothing held. A USDC market escrows every order's maximum loss
  before that order can rest or fill.
- **The two never mix inside one market.** Enforcement lives in `place_market_order`, the only
  function that can write `market_fills`, because a TypeScript check is one an attacker calls
  around. A mixed market was the real exposure: it let someone take a position with nothing
  behind it, writing a free option against the people who had actually funded theirs.

Established vocabulary, already shipped in `CreateMarketForm` — reuse it verbatim rather than
inventing synonyms: **"How is this market backed?"**, **IOU** / "Track who owes what, no deposit
needed", **USDC** / "Every order is backed by real funds held in escrow", and
"This can't be changed once the market is created."

Consequences for design:

- **Backing is a first-class fact on every market surface.** Whether the counterparty's money is
  actually there is the single most decision-relevant thing about a market, and it must never be
  something a user has to infer.
- On an IOU surface, never imply the app holds funds, escrows a stake, or guarantees a payout.
  A balance there is a **record of an obligation between two people**, not a wallet balance, and
  must not borrow custodial-finance language or styling.
- On a USDC market, escrow is real and may be stated plainly — but only there.
- Settlement on the IOU path is an act between people that the app records, not one it executes.

## Brand Commitments

- Name: **Over/Under**, set as `OVER/UNDER` in the existing landing wordmark.
- Existing tagline: "Private prediction markets with friends."

No logo, illustration, photography, or written voice guide has been established. Nothing else is
binding.

## Evidence on Hand

Pre-launch. Polygon Amoy testnet (chain 80002), test USDC, no production funds.

There are **no real users, no transaction volume, no testimonials, no press, no partners, and no
track record**. Future design must not fabricate any of it — no invented user counts, no sample
testimonials presented as real, no "trusted by" strip, no volume or accuracy statistics. Where a
surface needs proof, the honest material is the mechanism itself: how a bet is escrowed, how
resolution is confirmed, what happens in a dispute.

Real content that does exist: the app's own screens, the bet and market lifecycles, and the
status vocabulary above.

## Product Principles

1. **The terms are the product.** What was bet, by whom, on what condition, by when — legible at
   a glance and unambiguous at resolution. Everything else is secondary to this.
2. **Money is stated, never implied.** Stake, potential return, current exposure, and what is
   already locked are always explicit. Ambiguity about whose money is at risk is a defect, and it
   is doubly so while the money model is undecided.
3. **Design the wait.** Most of a bet's life is between placing and resolving. Waiting states,
   approaching deadlines, and price movement deserve real design, not an empty shell.
4. **The invite link carries the whole product.** A recipient arriving with no account and no
   context must understand the bet, the stake, and the ask before signing up.
5. **Claim only what exists.** Pre-launch, with no track record, credibility comes from
   explaining the mechanism precisely — never from borrowed social proof.
