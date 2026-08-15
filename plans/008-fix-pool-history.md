# 008 — Make the wager chart tell the truth about settled bets

- **Status**: TODO
- **Commit**: 8868ae9
- **Severity**: HIGH (money display correctness, not polish)
- **Category**: Correctness
- **Estimated scope**: 1 function, 1 call site, 1 test file. Small and precise.

## The bug

`lib/utils/getUserPoolHistory` in `lib/utils/betPool.ts` builds every point in a user's wager
history from **their own side**:

```ts
const side = mine.side;
const mySideTotal = side === "a" ? aTotal : bTotal;
const otherTotal  = side === "a" ? bTotal : aTotal;
const profit = mySideTotal > 0 ? (wager / mySideTotal) * otherTotal : 0;
const projectedPayout = wager + profit;
```

It never consults the resolution. So the net line trends toward a **win regardless of what
actually happened**, and a bet the user lost still charts a rising profit.

This is the same shape of bug as the one fixed in `c2b7896`, where `BetCard` passed `mine.side` as
the `winnerSide` argument to `getPariMutuelPreview` and made its zero-payout branch unreachable.
Same lesson: the function was asked the wrong question by its caller.

`components/bet/BetDetail.tsx` currently works around it by only rendering `BetWagerChart` when the
bet is live or the confirmed outcome is a win. **That workaround is not the fix** and should be
removed once this lands, so a settled loss charts correctly instead of being hidden.

## Important: the projection is correct while the bet is live

Do not "fix" that. While wagering is open there is no winner yet, and "if my side wins, this is
where I stand" is exactly the right question. The function is only wrong once a **confirmed**
resolution exists. Preserve the live behaviour byte for byte.

## Target

Add an optional third parameter. Absent means live, and behaviour is unchanged:

```ts
export function getUserPoolHistory(
  participants: Participant[],
  userId: string,
  winnerSide?: "a" | "b" | null
): UserPoolHistory
```

When `winnerSide` is a real side:

- If the user's side **is** the winner, the existing computation is already right. Keep it.
- If the user's side is **not** the winner, that point's `projectedPayout` is `0` and its `pnl` is
  `-wager`. They lost their stake; there is no profit curve.

`currentOdds` and `referenceOdds` describe how the pool was split over time and stay as they are —
they are history, not a claim about the outcome.

**Only a `status === 'confirmed'` resolution counts as a winner.** `pending`, `disputed`, and
`superseded` decide nothing. `getConfirmedResolution` already exists in `lib/utils/betOutcome.ts`;
reuse it rather than writing a second version.

Multi-option bets resolve on `proposed_winner_option_id`, not `proposed_winner_side`. This function
is the two-option path only — `betPool.ts` says so in its own header comment. If a multi-option bet
reaches it, that is a pre-existing condition; **do not extend the function to cover options in this
change.** Note it in your report if you see a path that would.

## Call site

`components/bet/BetDetail.tsx:275` is the only caller (verified by grep across `app/`,
`components/`, `lib/`). Pass the confirmed winner through, then **remove the render workaround**
around `BetWagerChart` so a settled loss shows its real, flat-to-negative line.

## Tests are required

Extend `tests/` with `node:test`, following `tests/betOutcome.test.ts` for conventions: explicit
`.ts` extensions, relative paths, no new dependencies. Cover at minimum:

- live bet, no winner passed: projection unchanged (guard the existing behaviour)
- settled, user's side won: payout and pnl match the winning computation
- settled, user's side lost: `projectedPayout === 0` and `pnl === -wager` at every point
- user is not a participant: empty points, `side` and `referenceOdds` null
- a winning side with an empty losing pool: profit is 0, not `NaN` or a divide-by-zero

That last one matters. `(wager / mySideTotal) * otherTotal` with `otherTotal === 0` should be a
clean zero.

## Boundaries

- Touch only `lib/utils/betPool.ts`, `components/bet/BetDetail.tsx`, and a test file.
- Do **NOT** modify `components/bet/BetWagerChart.tsx`, `lib/utils/betOutcome.ts`, `BetCard.tsx`,
  or any query, action, route, schema, or SQL.
- Do **NOT** change `getSideTotals`, `getPariMutuelPreview`, `getOptionPariMutuelPreview`, or
  `getPoolHistory`. Other code depends on them and they are correct.
- No dependencies. No styling changes.

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

The test count must **increase**, and every pre-existing test must still pass. Report both numbers.

**Done when:** a settled bet the user lost charts a real loss instead of being hidden, the live
projection is provably unchanged, and the new behaviour has test coverage.
