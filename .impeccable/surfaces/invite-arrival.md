# Surface brief — Invite-link arrival

Targets: `app/bet/[inviteCode]/page.tsx` and `app/market/[inviteCode]/page.tsx`
Mode: **Persuade** (the visitor decides and acts; this surface is the product's front door)
Status: confirmed with the user. Direction is settled; implementation is not.

---

## 1. Job and audience

Someone is in a group chat where an argument just happened. A friend drops a link. The
recipient taps it **on a phone, mid-conversation, with no account and no idea what this app is.**
They are not shopping for a betting product. They arrived because a specific person made a
specific claim and they have an opinion about it.

Two audiences hit the same URL and must not be traded off against each other:

- **The newcomer** (no account) — the conversion case, and the one the page is designed for.
- **The returning user** (signed in, not yet in this bet) — must not be made to re-read an
  explanation they've seen. Already-participating users are redirected to the real bet page
  today; keep that.

## 2. Outcome and proof

**Primary action:** take a side and commit a stake.
**Success:** a person who had never heard of Over/Under places a wager without ever feeling
they were asked to trust the app with money.

The only proof available is the bet itself and the people already in it — the creator's name,
who is on which side, what they put up, and the deadline. **There are no users, no volume, no
testimonials, and no track record to draw on.** Do not manufacture any. The mechanism is the
proof: what was bet, by whom, on what condition, by when.

## 3. Selected direction

**Visual authority: the incumbent world, preserved.** Dark ground, lime primary, heavy black
type, shadcn card vocabulary as defined in `app/globals.css`. This is a refinement inside an
established system, not a redesign. Do not introduce a new palette, typeface, or component
language. Do not add a light mode — the theme is deliberately dark-only.

**Thesis: this is not a landing page with a bet on it. It is the bet, made takeable.**

The proposition and the choice *are* the page. The app's identity, the money model, and the
sign-in are scaffolding that appears when it becomes relevant — not a preamble the visitor must
get through first.

**Sequence — the core change.** Today the flow is `read → sign in → choose → stake`. The single
highest-friction step sits before any investment. Invert it:

1. **The proposition leads.** The bet's title is the largest type on the page. Who proposed it
   and when it settles read as a live constraint beneath it.
2. **The choice is the center and is immediately actionable.** The sides stop being read-only
   summaries and become the primary interactive control. A newcomer can pick a side with no
   account, no modal, no interstitial.
3. **The stake follows the choice.** Amount entry appears once a side is taken, with min/max as
   real, visible constraints.
4. **Commitment reveals the terms.** At the commit action — not before — the page states plainly
   what it is doing: no money moves through Over/Under; this records that you owe the other side
   if you're wrong; you settle between yourselves. Honest disclosure at the honest moment.
5. **Then sign-in**, carrying the choice through it.

**Focal moment: picking a side.** That is the conversion event. Design it as the most
confident thing on the screen. Sign-in is a receipt step, not the climax.

**Implementation consequence:** the chosen side and amount must survive the OAuth round-trip.
See §7 — this is the main new engineering in the pass, and it has a security-relevant wrong way
to do it.

## 4. Scope and boundaries

**In scope:** both invite pages, brought to a shared structure. They are near-identical in job
and have drifted apart without reason — `/bet` sends to `/login` with "Continue with Google to
Wager", `/market` sends to `/signup` with "Sign Up to Trade". Resolve to one pattern.

**Untouched:**

- API route behavior, validation, and RLS. This is a presentation and flow pass.
- The app shell, nav, and every authenticated screen.
- The design tokens in `globals.css`.
- The already-a-participant redirect on both pages.
- Copy that states a product fact (labels, statuses, limits) unless this brief changes it.

**Anti-goals:**

- No fabricated social proof — no user counts, "trusted by", volume stats, or testimonials.
- No custodial-finance styling. It must not look like a wallet or an exchange, because under the
  current model the app holds nothing. See PRODUCT.md, "Money model — IOUs for now."
- No marketing section about the app. The bet is the pitch.
- No auto-submitting a wager after redirect (§7).

## 5. States and ranges

Every one of these is a real state on these pages and must be designed, not left to fall out:

| State | Requirement |
|---|---|
| Invalid / expired invite code | Already handled; keep it, but it currently dead-ends. Give it somewhere to go that makes sense for someone with no account. |
| Open, newcomer, nothing chosen | The default. The full conversion case. |
| Side chosen, entering amount | Min/max visible as constraints, not as error triggers. |
| Returned from auth with restored intent | Show what they're about to commit and require a confirm. **Never auto-place.** |
| Already signed in, not a participant | Skip the explanation weight; go straight to choose-and-stake. |
| Bet locked / resolving / resolved / cancelled / expired / stuck | Cannot join. Today this is a grey sentence and a dead end for signed-out users. It should still show the bet — someone who followed a link deserves to see what happened. |
| Nobody has wagered yet | First-mover state. Zero totals must read as an invitation, not as emptiness or failure. |
| Deadline passes while the page is open | The countdown reaching zero must change the page's affordances, not just display `0`. |

**Ranges to build against:** 2 options (typical) up to 6 (`bet_options` supports multi-option —
the current 2-column grid breaks down past 4); 0 to 20+ participants per side, so names need an
overflow rule; titles from a few words to a long sentence — do not design only for short ones;
`min_wager` and `max_wager` are both nullable; markets price 1–99 integer cents only.

## 6. Interaction and layout

- **Hierarchy, top to bottom:** proposition → sides (the choice) → stake → commit. The pool
  total currently outranks the bet title in visual weight (`text-2xl font-black text-primary`
  against `text-lg`). Invert that. An aggregate number means little to someone who just arrived;
  the claim is what they have an opinion about.
- **People, not headcounts.** "3 people" is the least persuasive form of the most persuasive
  content in a social betting product. Show who is on each side using the display names already
  loaded in the query, with a defined overflow rule. Add no new network calls for this.
- **The sides are one control, not two cards.** Semantically a single-choice group: real radio
  semantics, arrow-key navigable, visible focus, minimum 44px touch targets. A `div` with an
  `onClick` is a defect here, not a shortcut.
- **Mobile is the design case, not the adaptation.** This is opened on a phone from a chat app.
  Design mobile first and let desktop be the widened case. The current `max-w-sm` centered column
  is a reasonable starting point; do not assume it is the answer.
- **Motion is subordinate.** The side→stake reveal may transition, but nothing may delay the
  first meaningful interaction. Respect `prefers-reduced-motion`.
- **Feedback:** committing is the moment of consequence. It needs real pending and error states —
  a wager that silently fails on a page like this loses the user permanently.
- **Payout figures are projections, not promises.** Betting here is pari-mutuel: winners split
  the losing pool proportionally, so any "you could win $X" moves every time someone else joins.
  Show it as a live estimate tied to the current pool and never as a guaranteed return. This is
  a truthfulness requirement, not a stylistic one.

## 7. Constraints and open decisions

**Carrying intent through OAuth — do this the safe way.**
Persist the pending choice in `sessionStorage`, keyed by invite code, and restore it on return.
It survives the round-trip (same tab, same origin on return) and keeps the commitment out of
the URL entirely.

**Do not** encode side and amount into the `?redirect=` parameter. That parameter is already
user-influenced and feeds a post-auth redirect; widening it into a structured payload enlarges an
open-redirect surface for no gain. Whatever the builder does, the existing redirect target must
remain validated as a same-origin relative path.

**On return, restore — never auto-submit.** The user must see "you're placing $X on Y" and
confirm. Auto-placing a financial commitment as a side effect of a redirect is wrong on consent
grounds and fragile on refresh.

**Money language is load-bearing.** Under the IOU model a balance is a record of an obligation
between two people, not a wallet balance. "Escrow", "deposit", "funds", "payout", and "balance"
in the custodial sense are all wrong here. The USDC stack exists in the codebase but is not the
shipped path — do not surface it.

**Resolved since this brief was first written** (migration `016_market_backing.sql`, commit
`bf3a0bd`): a market declares its backing at creation and cannot change it. `iou` markets settle
to the ledger with nothing held; `usdc` markets escrow every order's maximum loss before it can
rest or fill, and the two can never mix inside one market.

This turns the old tension into a design requirement. **Backing is a first-class element of the
market invite page.** Someone deciding whether to take a position against a stranger needs to
know whether that stranger's money is actually there — it must be visible without scrolling and
never left to inference. Payout language follows from it: "contracts pay $1 if right" is accurate
on a `usdc` market and misleading on an `iou` one, so it is conditional, not fixed.

**Technical:** Next.js 16 App Router on Cloudflare Workers via OpenNext — read
`node_modules/next/dist/docs/` before using an unfamiliar API. Keep the wallet stack out of these
pages. Both pages are currently server components doing their own auth check; preserve that
boundary and push interactivity into client components rather than converting the page.

**Accessibility:** contrast-checked against the dark ground including the lime primary; the
countdown must not be the only signal that a bet is closing; full keyboard path from arrival to
commit; announce the side→stake reveal to assistive tech.
