import type {
  Bet,
  BetOption,
  BetParticipant,
  Profile,
  Resolution,
} from "@/lib/types";

type Participant = BetParticipant & { profiles: Profile };

export function normalizeLegacyParticipants<T extends BetParticipant>(
  participants: T[]
): T[] {
  return participants.map((participant) => ({
    ...participant,
    option_id: null,
  }));
}

export function normalizeLegacyResolutions<T extends Resolution>(
  resolutions: T[]
): T[] {
  return resolutions.map((resolution) => ({
    ...resolution,
    proposed_winner_option_id: null,
  }));
}

export function getOptionTotals(participants: Participant[], optionId: string) {
  const rows = participants.filter(
    (participant) =>
      (participant.option_id ?? participant.side) === optionId
  );
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
): {
  isParticipant: boolean;
  wager: number;
  payout: number;
  profit: number;
  refunded: boolean;
} {
  const { total: winTotal } = getOptionTotals(participants, winnerOptionId);
  const loseTotal = participants
    .filter(
      (participant) =>
        (participant.option_id ?? participant.side) !== winnerOptionId
    )
    .reduce((sum, p) => sum + p.amount, 0);

  const mine = participants.find((p) => p.user_id === userId);
  if (!mine) {
    return {
      isParticipant: false,
      wager: 0,
      payout: 0,
      profit: 0,
      refunded: false,
    };
  }

  if (winTotal === 0 || loseTotal === 0) {
    return {
      isParticipant: true,
      wager: mine.amount,
      payout: mine.amount,
      profit: 0,
      refunded: true,
    };
  }

  if ((mine.option_id ?? mine.side) !== winnerOptionId) {
    return {
      isParticipant: true,
      wager: mine.amount,
      payout: 0,
      profit: -mine.amount,
      refunded: false,
    };
  }

  const profit = (mine.amount / winTotal) * loseTotal;
  return {
    isParticipant: true,
    wager: mine.amount,
    payout: mine.amount + profit,
    profit,
    refunded: false,
  };
}

export function sortBetOptions<T extends { sort_order: number }>(options: T[]): T[] {
  return [...options].sort((a, b) => a.sort_order - b.sort_order);
}

export function getBetOptions(
  bet: Pick<Bet, "id" | "side_a_label" | "side_b_label"> & {
    bet_options: BetOption[];
  }
): BetOption[] {
  if (bet.bet_options.length > 0) {
    return sortBetOptions(bet.bet_options);
  }

  return [
    { id: "a", bet_id: bet.id, label: bet.side_a_label, sort_order: 0 },
    { id: "b", bet_id: bet.id, label: bet.side_b_label, sort_order: 1 },
  ];
}

export function getTotalPool(participants: Participant[]) {
  return participants.reduce((sum, p) => sum + p.amount, 0);
}
