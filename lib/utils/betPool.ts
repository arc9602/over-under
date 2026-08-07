import type { BetParticipant, Profile } from "@/lib/types";

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
