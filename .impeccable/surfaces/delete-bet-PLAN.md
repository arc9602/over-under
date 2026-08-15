# Plan — Delete a bet from the dashboard

Read this whole file before writing code. Then read `PRODUCT.md`. **You do not make product
decisions** — the rules below are settled. If something is genuinely unspecified, implement
everything else and report the gap.

## Why this is not a one-liner

Two facts constrain the whole design. Confirm both before you start:

1. **`supabase/migrations/001_initial_schema.sql:55`** — `iou_ledger.bet_id` references
   `public.bets(id)` with **no `ON DELETE CASCADE`**, so Postgres defaults to `NO ACTION` and
   refuses to delete any bet that has ledger rows. Same for `012_...:27` and `014_usdc_custody.sql:140`.
   Everything else (`bet_participants`, `resolutions`, `bet_invites`) **does** cascade.
2. **No `FOR DELETE` RLS policy exists on `bets`.** RLS is enabled, so with no policy a delete from
   the user client is denied and silently affects zero rows. Deleting requires new database
   permission that does not currently exist.

Together: a naive `.delete()` from the client would appear to do nothing, and if it were granted
naively it could destroy the record of what people agreed to bet.

## The rule

**Delete removes a bet that never really happened. Cancel ends one that did.**

Deletion is permitted only when *all* of these hold:

- `auth.uid()` is the bet's `creator_id`;
- the bet's status is **not** `resolved` and not `resolving`;
- **no `bet_participants` rows exist other than the creator's own** — nobody else took a side;
- no `iou_ledger`, ledger, settlement, or usdc transaction rows reference the bet.

Anything else is not deletable. The UI offers **Cancel** for those instead — `cancelBet` already
exists at `lib/actions/bets.ts:268` and handles `open`/`active`.

Rationale, so you do not "improve" on it: once someone else has staked a side, the bet is a record
of an agreement between people. Under the IOU model that record *is* the product. Destroying it
because the creator wants a tidier dashboard is the one thing this app must not do.

## Migration — `supabase/migrations/018_delete_bet.sql`

Follow the conventions in `017_direct_write_hardening.sql` and `015_friends_and_bet_invites.sql`
exactly. Read them first. Specifically:

- A `SECURITY DEFINER` function with **`SET search_path = ''`** (every such function in this repo
  pins it; one that does not is an escalation path).
- `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;` then
  `GRANT EXECUTE ... TO authenticated;`
- **Do not** add a `FOR DELETE` RLS policy. This repo's established pattern is that mutations go
  through `SECURITY DEFINER` functions and tables grant `SELECT` only — see
  `015_friends_and_bet_invites.sql:72-81`. Follow it.
- Fully-qualify every table (`public.bets`, not `bets`) — required, because `search_path` is empty.
- Take a row lock on the bet (`SELECT ... FOR UPDATE`) before validating, so a wager landing
  concurrently cannot slip in between the check and the delete.
- Raise a distinct, readable error per rejection reason; the action maps them to user-facing copy.
- A leading comment block explaining *what state this makes unreachable*, in the voice of the
  existing migrations.

Name it `delete_bet(p_bet_id UUID)`. Return something the caller can act on.

**This migration will NOT be applied automatically.** Say so in your report — the user applies SQL
by hand.

## Server action

Add `deleteBet` to `lib/actions/bets.ts`, mirroring `cancelBet` at line 268: validate the id with
`uuidSchema`, redirect unauthenticated callers, call the RPC, map errors to user-facing messages,
`revalidatePath("/dashboard")`, return `{ error }` or `{ success: true }`.

Do not change `cancelBet`.

## UI

`app/(app)/dashboard/page.tsx` was recently rebuilt — it ranks bets, renders `BetRow` at `md:`+ and
`BetCard` below. **Do not redesign it, do not reorder it, do not restyle it.** Add only what the
delete affordance needs.

- The control must not be the primary action. A bet row's job is to open the bet; delete is
  secondary and must never be mis-clickable on the way there.
- It is a destructive action, so it needs confirmation. Use the existing dialog primitive
  (`components/ui/dialog.tsx` or `alert-dialog` if present) — do not invent a new pattern and do
  not use `window.confirm`.
- The confirmation names the specific bet by title, and says plainly that it cannot be undone.
- Only render the control on bets that are actually deletable. Never show a control that will
  fail — compute eligibility from data already loaded (`bet_participants`), and let the RPC be the
  authority that backstops it.
- Pending and error states are required. Errors surface through `sonner` `toast.error`, matching
  the rest of the app.
- Use tokens only — `text-destructive` exists. No hardcoded colors. No `font-black`.

## Prohibitions

- Do not touch `components/bet/BetCard.tsx` styling, the ranking logic, or `lib/utils/betOutcome.ts`.
- Do not add dependencies. No light theme. No `window.confirm`.
- Do not weaken any existing grant, policy, or revoke.
- Do not add `ON DELETE CASCADE` to `iou_ledger` or any money table. That FK is load-bearing: it is
  the database's own refusal to destroy financial history, and it must keep refusing.
- Do not implement soft-delete/archive columns. Not in scope.

## Verify

```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx tsc --noEmit
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npm test
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx next build
```

You cannot run the migration or load `/dashboard` (Google OAuth). Do not attempt to sign in. Say
plainly in your report that the SQL path is unverified against a live database.

If you add pure helper logic (e.g. an `isDeletable(bet, userId)` predicate), **write `node:test`
coverage for it** under `tests/` — see `tests/betOutcome.test.ts` for conventions. Eligibility
logic about destroying records is exactly where a silent mistake would hurt.

## Report

**Done / Verified / Decisions I had to make / Flagged / Blocked.**

Earlier agents on this project reported a database trigger that exists nowhere in the codebase, and
claimed a payout showed `$0.00` when tracing proves it shows a positive figure. Every claim must be
verified against a file you actually read — cite `file:line`. When reasoning about runtime behavior,
trace the call path and say that is what you did. If uncertain, say so.
