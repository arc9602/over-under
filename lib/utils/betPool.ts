import type { Bet, BetOption, BetParticipant, Profile } from "@/lib/types";
import type { BetPoolPoint, UserBetPoolPoint } from "@/lib/types/charts";

type Participant = BetParticipant & { profiles: Profile };

/**
 * Every function above this line (getSideTotals through getUserPoolHistory)
 * is the 2-option path only -- side is always "a"/"b" there, never null, by
 * construction: place_wager rejects any bet with more than two
 * lib/utils/betPool.ts#bet_options rows, so a participant row this old code
 * ever sees is guaranteed to have side set. The option-based equivalents
 * below (getOptionTotals, getOptionPariMutuelPreview) are the 3+-option
 * path, keyed on option_id instead. getPredictedPayout doesn't need an
 * option-based twin -- it already just takes numbers, not sides.
 */
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
 *
 * `winnerSide` is optional and, absent, means the bet is still live: there's
 * no winner yet, so "if my side wins, this is where I stand" is the right
 * question and every point projects a win, exactly as before this parameter
 * existed. Once a real side is passed, that question only stays valid for
 * the side that actually won -- same computation, unchanged. For the losing
 * side, the projection collapses to the real outcome at every point: a
 * payout of 0 and a pnl of `-wager`, the stake that's gone. `currentOdds` and
 * `referenceOdds` are untouched either way -- they describe how the pool
 * split over time, not a claim about who won it.
 */
export function getUserPoolHistory(
  participants: Participant[],
  userId: string,
  winnerSide?: "a" | "b" | null
): UserPoolHistory {
  const sorted = [...participants].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  const mine = sorted.find((p) => p.user_id === userId);
  if (!mine) return { points: [], side: null, referenceOdds: null };

  const wager = mine.amount;
  const side = mine.side;
  const isSettledLoss = winnerSide != null && side !== winnerSide;

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
    const projectedPayout = isSettledLoss ? 0 : wager + profit;

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

/**
 * A bet's option list, sorted for display. Every bet has bet_options rows
 * from the moment it's created (a trigger backfills options 0/1 from
 * side_a_label/side_b_label for every bets INSERT -- see migration 012),
 * so the empty-array fallback below is defensive, not an expected path.
 */
export function getBetOptions(bet: Pick<Bet, "side_a_label" | "side_b_label"> & {
  bet_options: BetOption[];
}): BetOption[] {
  if (bet.bet_options.length > 0) {
    return [...bet.bet_options].sort((a, b) => a.sort_order - b.sort_order);
  }
  // Should be unreachable given the backfill trigger; kept as a fallback
  // rather than letting a rendering path crash on an empty option list.
  return [
    { id: "a", bet_id: "", label: bet.side_a_label, sort_order: 0, created_at: "" },
    { id: "b", bet_id: "", label: bet.side_b_label, sort_order: 1, created_at: "" },
  ];
}

/** option_id-keyed equivalent of getSideTotals, for a 3+-option bet. */
export function getOptionTotals(participants: Participant[], optionId: string) {
  const rows = participants.filter((p) => p.option_id === optionId);
  const total = rows.reduce((sum, p) => sum + p.amount, 0);
  return { total, count: rows.length, rows };
}

/**
 * option_id-keyed equivalent of getPariMutuelPreview. Same formula, same
 * "client-side preview only" caveat -- confirm_option_resolution is the
 * authoritative payout source.
 */
export function getOptionPariMutuelPreview(
  participants: Participant[],
  winnerOptionId: string,
  userId: string
): { isParticipant: boolean; wager: number; payout: number; profit: number } {
  const { total: winTotal } = getOptionTotals(participants, winnerOptionId);
  const loseTotal = participants
    .filter((p) => p.option_id != null && p.option_id !== winnerOptionId)
    .reduce((sum, p) => sum + p.amount, 0);

  const mine = participants.find((p) => p.user_id === userId);
  if (!mine || winTotal === 0) {
    return { isParticipant: false, wager: 0, payout: 0, profit: 0 };
  }

  if (mine.option_id !== winnerOptionId) {
    return { isParticipant: true, wager: mine.amount, payout: 0, profit: -mine.amount };
  }

  const profit = (mine.amount / winTotal) * loseTotal;
  return { isParticipant: true, wager: mine.amount, payout: mine.amount + profit, profit };
}
