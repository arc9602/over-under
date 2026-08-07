import type { BetParticipant, Profile } from "@/lib/types";

type Participant = BetParticipant & { profiles: Profile };

export function getOptionTotals(participants: Participant[], optionId: string) {
  const rows = participants.filter((p) => p.option_id === optionId);
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
  winnerOptionId: string,
  userId: string
): { isParticipant: boolean; wager: number; payout: number; profit: number } {
  const { total: winTotal } = getOptionTotals(participants, winnerOptionId);
  const loseTotal = participants
    .filter((p) => p.option_id !== winnerOptionId)
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

export function sortBetOptions<T extends { sort_order: number }>(options: T[]): T[] {
  return [...options].sort((a, b) => a.sort_order - b.sort_order);
}

export function getTotalPool(participants: Participant[]) {
  return participants.reduce((sum, p) => sum + p.amount, 0);
}
