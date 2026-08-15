import type { BetParticipant, BetStatus } from "@/lib/types";

/**
 * Client-side mirror of delete_bet's (migration 018) eligibility gate, using
 * only the fields already loaded for the dashboard -- creator_id, status,
 * and bet_participants. It exists so the delete control simply doesn't
 * render on a bet that would fail, rather than rendering it everywhere and
 * letting the RPC reject most clicks.
 *
 * This is deliberately a subset of the RPC's actual checks: it has no way to
 * see iou_ledger, ledger_transactions, usdc_transactions, or
 * usdc_escrow_locks rows from here, so it cannot rule out "financial records
 * exist" the way the database can. That's fine -- in practice a bet with
 * those rows already has other participants too (money only ever moves
 * between two sides), so this predicate and the RPC agree almost always, and
 * on the rare case they don't, the RPC is the one that gets the final word.
 * See delete_bet's own comment (018) for why it re-checks everything anyway
 * rather than trusting this.
 */
export function isBetDeletable(
  bet: {
    creator_id: string;
    status: BetStatus;
    bet_participants: Pick<BetParticipant, "user_id">[];
  },
  userId: string
): boolean {
  if (bet.creator_id !== userId) return false;
  if (bet.status === "resolved" || bet.status === "resolving") return false;
  return bet.bet_participants.every((p) => p.user_id === userId);
}
