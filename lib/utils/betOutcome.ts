import type { BetParticipant, Profile, Resolution } from "@/lib/types";
// Explicit .ts extension: this module is reachable from tests/betOutcome.test.ts,
// and Node's native TypeScript stripping (node --test) does not resolve
// extensionless relative specifiers the way a bundler does. See tsconfig.json's
// note on allowImportingTsExtensions -- safe under `moduleResolution: "bundler"`.
import { getPariMutuelPreview, getOptionPariMutuelPreview } from "./betPool.ts";

type Participant = BetParticipant & { profiles: Profile };

export type BetOutcome =
  | { kind: "won"; amount: number }
  | { kind: "lost"; amount: number }
  // No confirmed resolution to claim an outcome from -- covers a bet that's
  // resolved with no confirmed row yet, cancelled, expired, or stuck. None of
  // those are a reason to tell someone they won or lost anything.
  | { kind: "none" };

/**
 * `pending`, `disputed`, and `superseded` resolutions are proposals, not
 * outcomes. Only `confirmed` is; a bet can accumulate more than one row here
 * across a dispute/supersede cycle, so this picks the one that actually
 * settled it.
 */
export function getConfirmedResolution(resolutions: Resolution[]): Resolution | null {
  return resolutions.find((r) => r.status === "confirmed") ?? null;
}

/**
 * What a specific participant actually won or lost, from the bet's confirmed
 * resolution -- the real winner, not the participant's own side. Asking
 * getPariMutuelPreview "what if my side won?" trivially always answers with a
 * win, which was the bug this replaces (see components/bet/BetCard.tsx's
 * call site). Two-option bets carry the winner in `proposed_winner_side`;
 * multi-option bets carry it in `proposed_winner_option_id` -- exactly one is
 * set on any given row (XOR constraint, migration 012).
 */
export function getBetOutcome(
  participants: Participant[],
  resolutions: Resolution[],
  userId: string,
  isTwoOption: boolean
): BetOutcome {
  const confirmed = getConfirmedResolution(resolutions);
  if (!confirmed) return { kind: "none" };

  const mine = participants.find((p) => p.user_id === userId);
  if (!mine) return { kind: "none" };

  if (isTwoOption) {
    if (!confirmed.proposed_winner_side) return { kind: "none" };
    const preview = getPariMutuelPreview(participants, confirmed.proposed_winner_side, userId);
    if (!preview.isParticipant) return { kind: "none" };
    return mine.side === confirmed.proposed_winner_side
      ? { kind: "won", amount: preview.payout }
      : { kind: "lost", amount: preview.wager };
  }

  if (!confirmed.proposed_winner_option_id) return { kind: "none" };
  const preview = getOptionPariMutuelPreview(participants, confirmed.proposed_winner_option_id, userId);
  if (!preview.isParticipant) return { kind: "none" };
  return mine.option_id === confirmed.proposed_winner_option_id
    ? { kind: "won", amount: preview.payout }
    : { kind: "lost", amount: preview.wager };
}
