# Execution plan — Invite-link arrival

**Read this entire file before touching any code.** Then read
`.impeccable/surfaces/invite-arrival.md` (the design brief) and `PRODUCT.md` (product truth).
The brief says *what and why*. This file says *exactly what to do*. Where they appear to
conflict, the brief wins on intent and this file wins on mechanics — and you report the conflict.

**You do not make design decisions.** Every decision is already made below. If you hit something
this plan does not cover, do not invent an answer: implement everything else, and list the gap in
your report under "Decisions I had to make."

---

## 0. Before you write anything

Run these reads. Do not skip them; several assumptions people make about this codebase are wrong.

1. `lib/actions/bets.ts` — read it **in full**. You need the real signature of the wager action(s).
   `placeWager(identifier, side: "a" | "b", amount: number)` exists at line ~156. There is a
   separate path for bets with 3+ options. **Find it and note its exact signature before you
   design any payload.** Do not assume it mirrors `placeWager`.
2. `lib/utils/betPool.ts` — the payout math. Note `getPredictedPayout` and that everything here
   is a **preview only**; `confirm_resolution` is authoritative.
3. `lib/utils/safeRedirect.ts` — the open-redirect guard. Already used in
   `app/(auth)/login/LoginForm.tsx` and `app/api/auth/callback/route.ts`.
4. `components/bet/WagerForm.tsx` and `components/bet/OptionWagerForm.tsx` — existing behavior
   and props you must stay compatible with.
5. `app/bet/[inviteCode]/page.tsx` and `app/market/[inviteCode]/page.tsx` — what you are replacing.
6. `app/globals.css` — the design tokens. **Use these tokens. Never hardcode a hex or oklch value.**

### Units — get this right or the money will be wrong

- **Bet wagers are dollars as a plain number** (`min_wager`, `max_wager`, `amount`). The existing
  code does `Number(amountInput)` and `$${minWager.toFixed(2)}`. Confirm against `moneySchema`
  in the validation layer before you write arithmetic.
- **Market prices are integers 1–99** (cents of probability). Never a float, never outside 1–99.
- **The USDC stack uses integer minor units and is NOT in scope.** Do not import it, do not
  reference it, do not surface it anywhere on these pages.

### Absolute prohibitions

Violating any of these means the task failed, regardless of how good the rest looks.

- **Do not auto-submit a wager after the OAuth redirect.** Restore the choice, show it, require
  an explicit confirm click. No exceptions.
- **Do not put the side or amount into the `?redirect=` query parameter.** Use `sessionStorage`
  (§1). The redirect param stays exactly as it is and stays guarded by `safeRedirectPath`.
- **Do not weaken, bypass, or "simplify" `safeRedirectPath`.**
- **Do not change any API route, server action, validation schema, or SQL.** This is a
  presentation and flow pass. If you believe an action must change, stop and report it.
- **Do not invent social proof.** No user counts, no "trusted by", no testimonials, no volume
  stats, no fake activity. This product is pre-launch with zero users.
- **Do not describe a payout as guaranteed.** Betting here is pari-mutuel — winners split the
  losing pool proportionally, so every projection moves when someone else joins.
- **Do not add a light theme.** The app is deliberately dark-only.
- **Do not add new dependencies.** Everything needed is already installed.
- **Do not convert the pages away from server components.** They do their own auth check server
  side. Push interactivity into child client components.

---

## 1. Build `lib/utils/pendingWager.ts` (new file)

A tiny module that survives the OAuth round-trip. `sessionStorage` persists across the trip to
Google and back because it is the same tab and the same origin on return.

Export exactly this shape (adjust the bet payload fields to match the real action signatures you
found in step 0.1 — that is the one thing here you are allowed to adapt):

```ts
export type PendingWager =
  | { kind: "bet"; inviteCode: string; side: "a" | "b" | null; optionId: string | null; amount: number; savedAt: number }
  | { kind: "market"; inviteCode: string; side: "yes" | "no"; limitPrice: number; quantity: number; savedAt: number };

export function savePendingWager(w: PendingWager): void;
export function readPendingWager(kind: "bet" | "market", inviteCode: string): PendingWager | null;
export function clearPendingWager(kind: "bet" | "market", inviteCode: string): void;
```

Rules, all of them mandatory:

- Storage key must include both `kind` and `inviteCode` so two invites never collide.
- **Expire after 30 minutes.** `readPendingWager` returns `null` for anything older than
  `savedAt + 30 * 60 * 1000` and clears it.
- **Every function must be safe to call during SSR.** Guard with `typeof window === "undefined"`
  and return `null` / no-op. This runs on Cloudflare Workers; a bare `sessionStorage` reference
  at module scope will break the build.
- **Wrap every read in try/catch.** Corrupt or foreign JSON returns `null`, never throws.
- **Validate on read.** Check the parsed object actually matches the expected shape and that
  `inviteCode` equals the one requested. Never trust what came out of storage.
- Clear the entry immediately after a successful wager placement.

---

## 2. Build the side-choice control (new file, `components/bet/SideChoice.tsx`)

This is the focal element of the whole surface. It replaces the two read-only grey boxes.

- `"use client"`.
- Renders one choice per option. Must handle **2 to 6 options** — the current 2-column grid
  breaks past 4. Use a layout that reflows; do not hardcode `grid-cols-2`.
- **Real radio semantics.** Either native `<input type="radio">` visually restyled, or
  `role="radiogroup"` + `role="radio"` with `aria-checked` and full arrow-key handling. A `div`
  with `onClick` is a defect. Visible focus ring using the `--ring` token.
- Minimum **44×44px** touch target per choice.
- Each choice shows: the option label, the money already on it, and **who is on it by name** —
  use the display names already present in the query result. **Add no new network calls.**
  Overflow rule: show up to 3 names, then "+N more".
- Selected state must be unmistakable at a glance on a dark background — do not rely on color
  alone (a colorblind user must still see which is selected).
- Zero-state per option: when nothing is wagered yet, it must read as an invitation, not as
  broken. Use `No one yet` — not `$0.00` alone.

---

## 3. Rebuild `app/bet/[inviteCode]/page.tsx`

Order on screen, top to bottom. This ordering is the entire point of the redesign — **do not
reorder it**:

1. **The proposition.** `bet.title` is the largest, heaviest text on the page. Today it is
   `text-lg` while the pool total is `text-2xl font-black text-primary` — that inversion is the
   main bug. The pool total drops to a supporting detail.
2. **Attribution and deadline.** `{creator} started a bet` and the `CountdownTimer`.
3. **`<SideChoice />`** — the focal element from §2. Interactive with **no account required**.
4. **Stake entry** — appears once a side is chosen. `min_wager`/`max_wager` shown as visible
   constraints up front, not as errors after the fact. Both are nullable; handle null.
5. **Projected return** — live, using `getPredictedPayout`. Must be labelled as an estimate that
   moves. Exact copy: `Moves as others join.`
6. **The money disclosure**, immediately above the commit button. Exact copy:
   `Over/Under doesn't hold your money. This records what you owe — you and {creator} settle up
   yourselves.`
7. **Commit button.** Signed out: `Sign in to lock it in`. Signed in: `Put ${amount} on {label}`.

### The auth round-trip, step by step

**Signed out, user clicks commit:**
1. `savePendingWager({ kind: "bet", inviteCode, ... })`.
2. Navigate to `` `/login?redirect=${encodeURIComponent(`/bet/${inviteCode}`)}` `` — unchanged
   from today's format.

**On return to the page, now signed in:**
1. `readPendingWager("bet", inviteCode)`.
2. If `null` → render the normal choose-and-stake flow. Do nothing special.
3. If present → restore the side and amount into the UI **and render a confirm step** showing
   exactly what is about to happen: the side, the amount, and the projected return.
   Button: `Confirm — put ${amount} on {label}`. A secondary `Change` returns to editing.
4. **Only an explicit click on that button calls the action.** Never on mount, never in an
   effect, never automatically.
5. Clear the pending entry on success.

Note: `placeWager` already redirects unauthenticated callers itself (line ~164). Your
sessionStorage flow is the *good* path; that redirect stays as the safety net. Do not remove it.

---

## 4. Rebuild `app/market/[inviteCode]/page.tsx`

Same skeleton, same ordering logic, same auth round-trip, adapted to market content: best
yes/no prices, contracts, `OrderTicket`.

**Resolve the inconsistency:** `/bet` currently sends to `/login`, `/market` to `/signup`.
**Standardize on `/login`** for both — Google OAuth creates the account on first sign-in anyway,
so "Sign up" is a false distinction that costs conversion.

### Backing — read this before you write a single line of market copy

This was an open question when the brief was written. **It is now decided** by migration
`supabase/migrations/016_market_backing.sql`, which landed in commit `bf3a0bd`. Read that
migration's header comment before you start — it explains the exposure it closes.

`markets.backing` is `'iou' | 'usdc'`, chosen once at creation and **immutable** thereafter:

- **`iou`** — positions settle to `iou_ledger`. Nothing is held. Nobody's money is behind the
  other side of your trade.
- **`usdc`** — every order escrows its maximum loss before it can rest or fill.

**Backing is now a first-class element of this page, not a detail.** Someone arriving at a market
invite link is deciding whether to take a position against a stranger; whether that stranger's
money is actually there is the most decision-relevant fact available. It must be visible without
scrolling and must never have to be inferred.

**The `contracts pay $1 if right` line:** it is accurate on a `usdc` market and misleading on an
`iou` one. Make the line conditional on `market.backing`. On a `usdc` market it may state the
payout plainly. On an `iou` market it must make clear the obligation is between people and the
app guarantees nothing.

**Use the shipped vocabulary verbatim** — it already exists in
`components/market/CreateMarketForm.tsx` around lines 112–150. Do not invent synonyms:

- **IOU** — "Track who owes what, no deposit needed."
- **USDC** — "Every order is backed by real funds held in escrow."

`markets.backing` is already in `lib/types/database.types.ts`. Confirm the market query in
`lib/queries/markets.ts` actually selects it; if it does not, add the column to the select — that
is the **only** query change you are authorized to make.

---

## 5. States you must implement

Not optional. Each is a real state on these pages:

| State | Requirement |
|---|---|
| Invalid / expired invite code | Exists today but dead-ends. Give a signed-out visitor somewhere to go. |
| Open, newcomer, nothing chosen | The default and the main case. |
| Side chosen, entering amount | Limits visible as constraints, not post-hoc errors. |
| Returned from auth with restored intent | Confirm step. Never auto-place. |
| Signed in, not a participant | Skip the newcomer weight, straight to choose-and-stake. |
| Already a participant | Redirect to `/bets/{id}` — **exists today, keep it exactly as is.** |
| `locked` / `resolving` / `resolved` / `cancelled` / `expired` / `stuck` | Cannot join, but **still show the bet.** Someone who followed a link deserves to see what happened. |
| Nobody has wagered yet | First-mover state reads as an invitation. |
| Deadline passes while page is open | Countdown hitting zero must change what the page lets you do, not just display `0`. |
| Action fails | Real error state. A silently failing wager loses the user permanently. Existing code uses `sonner` `toast.error` — stay consistent. |

Build against: 2–6 options; 0 to 20+ participants; long titles as well as short; both wager
limits null.

---

## 6. Verify — run these and paste the real output

Node is at `C:\Program Files\nodejs`. In PowerShell, prepend it to PATH first:

```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx tsc --noEmit
```

```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npm test
```

Then check it renders. Use `preview_start` with `.claude/launch.json`, load a real invite URL,
and check `read_console_messages` for errors. Check **mobile (375px) and desktop together in one
pass** — mobile is the design case. Do not enter an open-ended polish loop: build fully, inspect
once, fix everything found in one batch, confirm once, stop.

**Never report a check you did not run.** If something fails and you cannot fix it, paste the
actual output and say so. An honest failure report is worth more than a clean-sounding one.

---

## 7. Report back in exactly this format

- **Done** — each file changed, one line each.
- **Verified** — the exact commands run and their real results.
- **Decisions I had to make** — anything this plan underspecified, and what you assumed.
- **Flagged** — anything that looked wrong but was out of scope. Note in particular whether
  `lib/queries/markets.ts` already selected `backing`, and whether any other market surface
  displays payout language that is wrong for IOU-backed markets.
- **Blocked** — what you did not do, and why.
