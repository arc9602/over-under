# Surface brief + execution plan — Dashboard ("My Bets")

Target: `app/(app)/dashboard/page.tsx` and the components it renders.
Mode: **Operate** — the visitor is in a task, not being persuaded.
Status: direction settled. Implementation is not. **You do not make design decisions.**

Read this entire file before writing code. Then read `PRODUCT.md`. Where this file and your
instincts disagree, this file wins. If something here is genuinely unspecified, implement
everything else and list the gap in your report — do not invent an answer.

---

## The diagnosis

The user's words were "it looks vibecoded." That is a real critique with specific causes, and
these are the causes. Fixing the causes is the job; making it "look nicer" is not.

1. **A design system was declared and then ignored.** `app/globals.css` defines `--color-win`,
   `--color-resolving`, and `--color-loss`. They are used **zero times**. Across
   `components/` and `app/` there are **94 hardcoded Tailwind palette classes** instead
   (`text-emerald-400`, `text-rose-400`, …). The reason is mechanical, not lazy: those tokens
   live in `:root`, not in `@theme inline`, so Tailwind v4 generates no `text-win` utility from
   them. They have never done anything. See §A for the fix.
2. **Every bet renders identically regardless of state.** A cancelled test bet, an open bet with
   no wagers, and a live bet with real money all get the same box, same size, same weight. In the
   user's screenshot the CANCELLED cards are exactly as loud as the OPEN one. Uniform treatment
   of non-uniform things is the single strongest "generated" tell.
3. **Density is absurd for a money dashboard.** Three bets fill a 1080px viewport. Each card is
   ~150px tall to carry a badge, a short title, and one line of text. Cards span the full ~1470px
   content width for content occupying the left ~200px.
4. **`font-black` is on everything** — page title, numbers, bet titles, badges. When everything is
   the heaviest weight, nothing is emphasized.
5. **The stat tiles are a template.** "LIVE BETS 2" / "AT RISK $5.00" in two oversized boxes is the
   hero-metric pattern — big number, small label, accent — which impeccable's craft floor names
   explicitly as a thing to refuse.
6. **Browser surfaces are stock.** Text selection, focus rings, scrollbar, and numerals all ship
   with browser defaults belonging to no design system. The craft floor calls this "the cheapest
   signal that a page was built rather than assembled, and the one models skip most reliably."
7. **The subtitle is filler.** "Private prediction markets with friends" under "My Bets" is the
   landing-page tagline reused where the user already knows what the app is.
8. **The empty state says "No bets here."** Operate guidance is explicit: empty states teach the
   interface, they do not announce emptiness.

Two confirmed defects, visible in the user's screenshot, fold into this work:

- `components/bet/BetCard.tsx:104` — `totalPool > 0 ? "... in the pool" : "Waiting for wagers"`
  ignores status, so a **cancelled** bet reads "Waiting for wagers." It is not waiting; it is over.
- `components/bet/BetCard.tsx:108` — `{isTwoOption && <SplitBar .../>}` renders at `0`/`0`, drawing
  a 50/50 green/red bar that reads as even odds when there is no money at all.

Note that `BetCard.tsx:110` already guards the countdown with
`bet.status !== "resolved" && bet.status !== "cancelled"`. The file already knows how to do this.
Two of its three state-dependent elements just never got the treatment.

## The direction

**"My Bets" is a position sheet, not a feed.**

Someone opening this page has one question: *where is my money, and what needs me?* Today the page
answers neither — it is a reverse-chronological stack of equal-weight cards.

Three moves, in priority order:

1. **Rank by what needs the user, not by recency.** Bets needing action come first and read
   loudest. Live bets with the user's stake follow. Settled and cancelled recede — they are
   history, not inventory.
2. **Density, via rows at desktop.** A bet becomes a row: title, side, stake, pool, deadline,
   status. Ten-plus visible at once instead of three. Cards return below the breakpoint where rows
   cannot work. Operate guidance permits this explicitly: "Density. Tables with many rows … when
   users need it."
3. **Retire the stat tiles.** Exposure belongs inline in the page header as context for the list
   beneath it, not as two lonely boxes consuming 100px.

**Preserve the world.** Dark ground, lime primary, shadcn component vocabulary. This is a
refinement inside an established system, not a new visual identity. Do not introduce a new palette,
a display typeface, or a new component language. Do not add a light theme.

---

# SECTION A — your scope

Sections B and C are a different agent's job. **Do not touch
`app/(app)/dashboard/page.tsx`** — that is Section B.

## A1. Make the semantic tokens real

In `app/globals.css`:

1. In `:root`, rename the three status variables from `--color-win` / `--color-resolving` /
   `--color-loss` to `--win` / `--resolving` / `--loss`. **Keep their exact oklch values.**
2. Do the same in the `.dark` block if it declares them, so the two blocks stay consistent.
3. In the `@theme inline` block, add three entries alongside the existing ones:
   ```css
   --color-win: var(--win);
   --color-resolving: var(--resolving);
   --color-loss: var(--loss);
   ```
   This is what generates `text-win`, `bg-loss/10`, `border-resolving`, etc. Without it the tokens
   remain decorative, which is the whole bug.
4. Verify a utility actually compiles before going further — put `text-win` on something, run the
   build, confirm the color applies. If it does not, stop and report; everything below depends on it.

## A2. Replace raw palette classes **in your scope files only**

Files: `components/bet/BetCard.tsx`, `components/bet/BetStatusBadge.tsx`,
`components/shared/SplitBar.tsx`, `components/shared/EmptyState.tsx`.

Map: emerald → `win`, rose → `loss`, amber → `resolving`.

There are 94 such classes project-wide. **Do not migrate the other files** — chart components and
wallet/market surfaces are out of scope and touching them makes this unreviewable. Report the
remaining count so a follow-up can be scoped.

## A3. Fix the two defects

- The pool line must account for status. A terminal bet (`cancelled`, `expired`, `resolved`,
  `stuck`) with an empty pool must not say "Waiting for wagers." Exact copy: `No wagers were
  placed.` A non-terminal bet with an empty pool keeps `Waiting for wagers`.
- `SplitBar` must not render when `leftValue + rightValue === 0`. Put the guard **inside
  `SplitBar`**, not at the call site, so no future caller can reintroduce it.

## A4. State-differentiated card treatment

A `BetCard` must not look the same in every state.

- **Terminal** (`resolved`, `cancelled`, `expired`, `stuck`): recede. Muted foreground, no accent
  color on numbers, no countdown, no split bar. It is a record, not an opportunity.
- **Needs action** (`resolving`): the loudest state. Use `resolving` as its signal color.
- **Live with the user's stake** (`mine` is set, status non-terminal): the user's money is the
  point — the stake and projected return carry the emphasis.
- **Live without the user's stake**: normal weight; the pool is the interesting fact.

Do not encode state by color alone — a colorblind user must still perceive the difference through
weight, opacity, or border.

## A5. Typography and browser surfaces

- **Stop using `font-black` as the default.** Reserve the heaviest weight for one element per
  card. Build a real step scale — Operate guidance wants a tight 1.125–1.2 ratio, not the current
  jumble of `text-[10px]`, `text-xs`, `text-sm`, `text-xl`, `text-2xl` all at `font-black`.
- **All money and counts get `tabular-nums`.** Figures that shift width as they change are the
  clearest sign nobody looked.
- **Retire the `text-[10px] uppercase tracking-wider` micro-label habit.** It appears on STAKE,
  POTENTIAL WIN, LIVE BETS, AT RISK. It is a tic standing in for hierarchy. Where a label is
  genuinely needed, let size and color carry it.
- In `globals.css`, theme the browser surfaces the app currently leaves stock: `::selection`,
  `:focus-visible` ring, and scrollbar colors, all drawn from existing tokens. Keep focus rings
  clearly visible — this is an accessibility affordance, not decoration.

## A6. The empty state

`EmptyState` must teach the interface rather than announce absence. Replace `No bets here.` The
all-tab case should explain what a bet is and how one starts; a filtered tab should say what that
filter would contain. Keep the existing prop signature so callers do not break.

---

## Absolute prohibitions

- **Do not touch `app/(app)/dashboard/page.tsx`.** Section B owns it.
- Do not change any query, server action, API route, validation schema, or SQL. This is
  presentation only.
- Do not add dependencies. Do not add a light theme. Do not add a display font.
- Do not invent social proof — this product is pre-launch with zero users.
- Do not describe a payout as guaranteed. Payouts are pari-mutuel and move as people join.
- Do not use a hardcoded color anywhere. Every color comes from a token.
- Do not add decorative motion. Transitions convey state only, 150–250ms.

## Verify

In PowerShell (Node lives at `C:\Program Files\nodejs`):

```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx tsc --noEmit
```

```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npm test
```

Then run the project's own design detector on what you changed and act on its findings:

```bash
node .claude/skills/impeccable/scripts/detect.mjs components/bet/BetCard.tsx components/shared
```

Paste real output for all three. **Never report a check you did not run.**

Build fully, inspect once, fix everything found in one batch, confirm once, stop. Do not enter an
open-ended polish loop.

## Report

Use exactly: **Done / Verified / Decisions I had to make / Flagged / Blocked.**

A previous agent on this project reported a database trigger that does not exist anywhere in the
codebase and drew a false conclusion from it. Every claim you make must be something you verified
by reading the actual file — cite `file:line`. If you are not certain, say so. An honest "I did not
verify this" is worth more than a confident fabrication.

---

# SECTION B — dashboard composition

Scope: `app/(app)/dashboard/page.tsx`. Section A is **done and committed**; treat
`globals.css`, `BetCard`, `BetStatusBadge`, `SplitBar`, and `EmptyState` as finished work you
build on, not files to revise. If you believe one must change, stop and report it.

- **Retire the two stat `Card` tiles.** "LIVE BETS 2" / "AT RISK $5.00" is the hero-metric
  template the craft floor names as a refuse. Exposure moves into the page header as context for
  the list beneath it — one line, not two boxes consuming 100px.
- **Delete the subtitle** "Private prediction markets with friends." It is the landing-page
  tagline reused where the user already knows what the app is.
- **Rank by what needs the user, not recency:** needs-action (`resolving`) → live with the user's
  stake → live without stake → terminal. Today it is a flat reverse-chronological dump where a
  cancelled test bet sits above a live one with real money on it.
- **Rows at `md:` and up, cards below.** Ten-plus bets visible at once instead of three. A row
  carries: title, the user's side, stake, pool, deadline, status. Below `md`, keep `BetCard`.
  Operate guidance permits this density explicitly.
- Tabs keep their counts — those are genuinely useful.

**A6 copy, now unblocked and yours.** The literal string `No bets here` lives at
`app/(app)/dashboard/page.tsx:102`, which Section A was forbidden from touching — that was a
contradiction in this plan, not the agent's error. `EmptyState` renders whatever `title` and
`description` its caller passes, so the fix belongs here. Empty states teach the interface rather
than announce absence: the all-tab case should explain what a bet is and how one starts; a
filtered tab should say what that filter would contain. Do not change `EmptyState`'s props.

Same prohibitions as Section A: no hardcoded colors (tokens only — `text-win`, `text-loss`,
`text-resolving` now work), no new dependencies, no light theme, no decorative motion, no
query/action/route/schema/SQL changes, no invented social proof, never describe a payout as
guaranteed.

# SECTION C — remaining token migration (NOT your scope)

The other ~78 raw palette classes across chart, wallet, market, and balance components. Separate
pass, separate review.

---

# SECTION D — a settled bet must show what actually happened

## The bug, traced rather than assumed

`components/bet/BetCard.tsx:42` calls:

```ts
getPariMutuelPreview(bet.bet_participants, mine.side!, currentUserId)
```

It passes **the user's own side** as the `winnerSide` argument. Inside
`lib/utils/betPool.ts`, the guard `if (mine.side !== winnerSide)` — the branch that returns
`payout: 0, profit: -mine.amount` — can therefore never be true from this call site. It is
unreachable. Every call falls through to the winning computation.

Consequence: **a resolved bet the user lost displays a positive figure labeled "Potential win."**
An earlier report claimed it shows `$0.00` on a loss. It does not; that claim was wrong, and it is
why this section exists.

This is display-only — settlement runs through the `confirm_resolution` RPC and the ledger is
unaffected — but a money product telling someone they won something they lost is not acceptable.

## Verified facts (do not re-derive; do confirm if you touch them)

- `lib/queries/bets.ts:4` `getBetsForUser` does **not** select resolutions.
  `getBetById` at line 60 does (`resolutions (*)`).
- `lib/types/index.ts:44` `BetWithParticipants` has no `resolutions`. Line 50 `BetWithDetails` is
  the same shape **plus** `resolutions: Resolution[]`.
- `resolutions` columns: `proposed_winner_side` (`'a'|'b'`, nullable since migration 012),
  `proposed_winner_option_id` (UUID, nullable), with a XOR constraint that exactly one is
  non-null; and `status` in `('pending','confirmed','disputed','superseded')`.
- Blast radius is fully contained: `getBetsForUser` is called only by
  `app/(app)/dashboard/page.tsx`; `BetCard` is rendered only there; `BetWithParticipants` appears
  in only four files.

## Authorized exceptions

Every other section forbids query and type changes. **This section explicitly permits exactly
two**, and nothing beyond them:

1. `getBetsForUser` may gain `resolutions (*)` in its select.
2. `lib/types/index.ts` may change so the dashboard's bets carry `resolutions`. `BetWithDetails`
   already describes that shape — prefer reusing it over inventing a third type.

Still forbidden: any server action, API route, validation schema, SQL migration, or RPC.

## The fix

The minimal correct change is at the **call site**, not in `betPool.ts`. `getPariMutuelPreview`
is already correct; it was being asked the wrong question. Pass the **actual confirmed winner**
instead of the user's own side, and its existing zero-payout branch starts working:

- Two-option: pass the confirmed resolution's `proposed_winner_side`.
- Multi-option: pass its `proposed_winner_option_id` to `getOptionPariMutuelPreview`.

**Only a resolution with `status === 'confirmed'` is an outcome.** `pending`, `disputed`, and
`superseded` are not. Never render a win or loss without a confirmed row.

## Required display behavior

| Bet state | What the card shows |
|---|---|
| Non-terminal, user has a stake | Unchanged — `Potential win`, the live projection, still labelled as moving |
| `resolved`, confirmed resolution, user's side won | `Won` and the real amount |
| `resolved`, confirmed resolution, user's side lost | `Lost` and the stake they gave up |
| `resolved` but **no** confirmed resolution | No outcome claim. Show the stake only. |
| `cancelled` | See below — check the SQL before writing copy |
| `expired` / `stuck` | No outcome claim. Show the stake only. |

**On `cancelled`: do not guess.** Read the cancellation path in `supabase/migrations/` and
determine whether stakes are actually returned. If they are, say so plainly. If they are not, or
you cannot tell, show the stake with neutral language and **report what you found** rather than
writing reassuring copy that may be false.

Keep `tabular-nums` on every figure. Use `text-win` / `text-loss` for outcomes — those utilities
work now. Never carry the win/loss distinction by color alone.

## Also in scope: one stray hardcoded color

`components/bet/CountdownTimer.tsx:29` is `<span className="text-xs text-amber-400">`. It fell
through the gap between Section A's file list and Section B's, and it renders inside both the card
and the new row. Change it to `text-resolving`, which is the token that colour was standing in
for. That file and `BetCard.tsx` are the only two you may touch beyond the query and type changes
authorized above.

## Verify

```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx tsc --noEmit
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npm test
```
```bash
node .claude/skills/impeccable/scripts/detect.mjs components/bet/BetCard.tsx
```

`tests/` uses `node:test` with no DOM, so pure functions are testable and components are not. If
you add a helper that picks the confirmed resolution and derives the outcome, **write tests for
it** — that is exactly the kind of pure logic this suite covers, and it is where a mistake would
be silent and about money.
