import type { BetParticipant, Profile } from "@/lib/types";
import type { BetPoolPoint, UserBetPoolPoint } from "@/lib/types/charts";

type Participant = BetParticipant & { profiles: Profile };

export function getSideTotals(participants: Participant[], side: "a" | "b") {
  const rows = participants.filter((p) => p.side === side);
  const total = rows.reduce((sum, p) => sum + p.amount, 0);
  return { total, count: rows.length, rows };
}

/**
 * Client-side pari-mutuel preview only -- authoritative payout numbers
 * always come from the confirm_resolution RPC. Mirrors that SQL formula:
 * a winner's total receipts equal their stake's share of the winning pool,
 * scaled by the entire losing pool.
 */
export function getPariMutuelPreview(
  participants: Participant[],
  winnerSide: "a" | "b",
  userId: string
): { isParticipant: boolean; wager: number; payout: number; profit: number } {
  const { total: winTotal } = getSideTotals(participants, winnerSide);
  const loserSide = winnerSide === "a" ? "b" : "a";
  const { total: loseTotal } = getSideTotals(participants, loserSide);

  const mine = participants.find((p) => p.user_id === userId);
  if (!mine || winTotal === 0) {
    return { isParticipant: false, wager: 0, payout: 0, profit: 0 };
  }

  if (mine.side !== winnerSide) {
    return { isParticipant: true, wager: mine.amount, payout: 0, profit: -mine.amount };
  }

  const profit = (mine.amount / winTotal) * loseTotal;
  return { isParticipant: true, wager: mine.amount, payout: mine.amount + profit, profit };
}

/**
 * Predicted payout if `hypotheticalAmount` more is wagered on `side` and it
 * wins, given the pool as it stands right now -- the live preview shown
 * while filling out WagerForm, before the wager is actually placed.
 * `existingAmount` is what the user has already staked on that side (0 for a
 * first-time wager); `sideTotal`/`otherSideTotal` are that side's and the
 * opposing side's *current* pool totals (which already include
 * `existingAmount` if the user has a prior stake).
 */
export function getPredictedPayout(
  sideTotal: number,
  otherSideTotal: number,
  existingAmount: number,
  hypotheticalAmount: number
): { payout: number; profit: number } | null {
  if (hypotheticalAmount <= 0) return null;

  const myWager = existingAmount + hypotheticalAmount;
  const winTotal = sideTotal + hypotheticalAmount;
  const profit = (myWager / winTotal) * otherSideTotal;
  return { payout: myWager + profit, profit };
}

/**
 * The whole pool's implied-probability history, one point per participant
 * row in join order. `sideAProbability` is a *share of money wagered*, not a
 * discovered price -- the pari-mutuel analogue of MarketOddsPoint.
 *
 * bet_participants keeps exactly one row per user (place_wager upserts on
 * top-up, see migrations/007_cumulative_wager_limits.sql), so a top-up after
 * someone's first wager is reflected in their row's final `amount` but not as
 * a separate point at its own time -- this is the pool's shape as best as the
 * schema can reconstruct it, not a full wager-by-wager ledger.
 */
export function getPoolHistory(participants: Participant[]): BetPoolPoint[] {
  const sorted = [...participants].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  let aTotal = 0;
  let bTotal = 0;

  return sorted.map((p) => {
    if (p.side === "a") aTotal += p.amount;
    else bTotal += p.amount;

    const poolTotal = aTotal + bTotal;
    const sideAProbability = poolTotal > 0 ? Math.round((aTotal / poolTotal) * 100) : 50;

    return {
      timestamp: new Date(p.joined_at).getTime(),
      sideAProbability,
      sideBProbability: 100 - sideAProbability,
      poolTotal,
    };
  });
}

export type UserPoolHistory = {
  points: UserBetPoolPoint[];
  side: "a" | "b" | null;
  /** Implied probability of the user's side at the moment they joined. */
  referenceOdds: number | null;
};

/**
 * A user's pari-mutuel position, marked against the pool split at every
 * subsequent participant event from their entry onward. See getPoolHistory's
 * note on the one-row-per-user limitation: `wager` is fixed across all
 * points (we only know its final value, not a history of top-ups).
 */
export function getUserPoolHistory(participants: Participant[], userId: string): UserPoolHistory {
  const sorted = [...participants].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  const mine = sorted.find((p) => p.user_id === userId);
  if (!mine) return { points: [], side: null, referenceOdds: null };

  const wager = mine.amount;
  const side = mine.side;

  let aTotal = 0;
  let bTotal = 0;
  let referenceOdds: number | null = null;
  const points: UserBetPoolPoint[] = [];

  for (const p of sorted) {
    if (p.side === "a") aTotal += p.amount;
    else bTotal += p.amount;

    const poolTotal = aTotal + bTotal;
    const mySideTotal = side === "a" ? aTotal : bTotal;
    const otherTotal = side === "a" ? bTotal : aTotal;
    const currentOdds = poolTotal > 0 ? Math.round((mySideTotal / poolTotal) * 100) : 50;

    if (p.user_id === userId) {
      referenceOdds = currentOdds;
    }

    // Still accumulating pre-entry totals -- don't emit a point yet.
    if (p.joined_at < mine.joined_at) continue;

    const profit = mySideTotal > 0 ? (wager / mySideTotal) * otherTotal : 0;
    const projectedPayout = wager + profit;

    points.push({
      timestamp: new Date(p.joined_at).getTime(),
      currentOdds,
      projectedPayout,
      wager,
      pnl: projectedPayout - wager,
    });
  }

  return { points, side, referenceOdds };
}
