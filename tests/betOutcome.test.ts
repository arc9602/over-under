/**
 * Unit tests for getBetOutcome -- the fix for BetCard's "always shows a win"
 * bug. components/bet/BetCard.tsx used to call getPariMutuelPreview with the
 * user's *own* side as the winner, so its `mine.side !== winnerSide` loss
 * branch could never be reached: every resolved bet the user actually lost
 * still rendered a positive "Potential win" figure. getBetOutcome instead
 * takes the winner from the bet's confirmed resolution, so a real loss comes
 * back as a real loss.
 *
 *   node --test tests/
 *
 * Same conventions as amount.test.ts: node:test, no new dependencies,
 * explicit .ts extensions and relative paths -- Node's native type stripping
 * resolves neither extensionless specifiers nor tsconfig's "@/*" alias.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { getBetOutcome, getConfirmedResolution } from "../lib/utils/betOutcome.ts";

// Minimal fixtures -- only the fields getBetOutcome and the betPool preview
// functions it calls actually read (side/option_id/amount/user_id, and the
// resolution's status/proposed_winner_*). `profiles` is never touched by
// this logic, so an empty stub is enough to satisfy the participant shape.
function participant(p: {
  userId: string;
  amount: number;
  side?: "a" | "b" | null;
  optionId?: string | null;
}) {
  return {
    id: p.userId,
    bet_id: "bet-1",
    user_id: p.userId,
    side: p.side ?? null,
    option_id: p.optionId ?? null,
    amount: p.amount,
    joined_at: "2026-01-01T00:00:00Z",
    profiles: {},
  };
}

function resolution(r: {
  status: "pending" | "confirmed" | "disputed" | "superseded";
  winnerSide?: "a" | "b" | null;
  winnerOptionId?: string | null;
}) {
  return {
    id: `res-${r.status}-${r.winnerSide ?? r.winnerOptionId ?? "none"}`,
    bet_id: "bet-1",
    proposed_by: "someone",
    proposed_winner_side: r.winnerSide ?? null,
    proposed_winner_option_id: r.winnerOptionId ?? null,
    confirmed_by: r.status === "confirmed" ? "someone" : null,
    status: r.status,
    created_at: "2026-01-01T00:00:00Z",
    resolved_at: null,
  };
}

// getBetOutcome's declared parameter types come from a private alias inside
// betOutcome.ts, so the fixtures above are structurally compatible but not
// nominally typed -- cast at the call boundary the same way a Supabase
// response would be cast against the generated Database type.
const outcome = getBetOutcome as unknown as (
  participants: ReturnType<typeof participant>[],
  resolutions: ReturnType<typeof resolution>[],
  userId: string,
  isTwoOption: boolean
) => { kind: "won" | "lost" | "none"; amount?: number };

const confirmedResolution = getConfirmedResolution as unknown as (
  resolutions: ReturnType<typeof resolution>[]
) => ReturnType<typeof resolution> | null;

describe("getConfirmedResolution", () => {
  test("picks the confirmed row out of a mixed history", () => {
    const rows = [
      resolution({ status: "disputed", winnerSide: "a" }),
      resolution({ status: "superseded", winnerSide: "a" }),
      resolution({ status: "confirmed", winnerSide: "b" }),
    ];
    assert.equal(confirmedResolution(rows)?.status, "confirmed");
    assert.equal(confirmedResolution(rows)?.proposed_winner_side, "b");
  });

  test("returns null when nothing is confirmed yet", () => {
    const rows = [resolution({ status: "pending", winnerSide: "a" })];
    assert.equal(confirmedResolution(rows), null);
  });

  test("returns null for an empty history", () => {
    assert.equal(confirmedResolution([]), null);
  });
});

describe("getBetOutcome -- two-option bets", () => {
  test("the winning side sees 'won' with the real payout, not their own stake back", () => {
    const participants = [
      participant({ userId: "alice", amount: 10, side: "a" }),
      participant({ userId: "bob", amount: 10, side: "b" }),
    ];
    const resolutions = [resolution({ status: "confirmed", winnerSide: "a" })];

    const result = outcome(participants, resolutions, "alice", true);
    assert.equal(result.kind, "won");
    // Pari-mutuel: alice's 10 plus her full share of bob's losing 10.
    assert.equal(result.amount, 20);
  });

  test("the losing side sees 'lost' with the stake they gave up -- the bug this replaces", () => {
    const participants = [
      participant({ userId: "alice", amount: 10, side: "a" }),
      participant({ userId: "bob", amount: 10, side: "b" }),
    ];
    const resolutions = [resolution({ status: "confirmed", winnerSide: "a" })];

    // Before the fix, BetCard asked "did bob's own side (b) win?" by passing
    // b as winnerSide, which is a different question than "did a win?" and
    // always resolved to bob's own side, i.e. always a false 'won'.
    const result = outcome(participants, resolutions, "bob", true);
    assert.equal(result.kind, "lost");
    assert.equal(result.amount, 10);
  });

  test("a winner with nobody on the other side still 'won', even with zero profit", () => {
    // Regression guard for a naive `payout > 0` heuristic: a win with no
    // losing pool pays back exactly the stake (profit 0), which must not be
    // mistaken for a loss.
    const participants = [participant({ userId: "alice", amount: 10, side: "a" })];
    const resolutions = [resolution({ status: "confirmed", winnerSide: "a" })];

    const result = outcome(participants, resolutions, "alice", true);
    assert.equal(result.kind, "won");
    assert.equal(result.amount, 10);
  });

  test("no confirmed resolution yet -- pending only -- makes no outcome claim", () => {
    const participants = [
      participant({ userId: "alice", amount: 10, side: "a" }),
      participant({ userId: "bob", amount: 10, side: "b" }),
    ];
    const resolutions = [resolution({ status: "pending", winnerSide: "a" })];

    assert.equal(outcome(participants, resolutions, "alice", true).kind, "none");
    assert.equal(outcome(participants, resolutions, "bob", true).kind, "none");
  });

  test("a disputed or superseded resolution alone makes no outcome claim", () => {
    const participants = [participant({ userId: "alice", amount: 10, side: "a" })];
    const resolutions = [
      resolution({ status: "disputed", winnerSide: "a" }),
      resolution({ status: "superseded", winnerSide: "a" }),
    ];

    assert.equal(outcome(participants, resolutions, "alice", true).kind, "none");
  });

  test("resolved with zero resolution rows -- e.g. stuck or a data gap -- makes no outcome claim", () => {
    const participants = [participant({ userId: "alice", amount: 10, side: "a" })];
    assert.equal(outcome(participants, [], "alice", true).kind, "none");
  });

  test("a non-participant gets no outcome claim", () => {
    const participants = [
      participant({ userId: "alice", amount: 10, side: "a" }),
      participant({ userId: "bob", amount: 10, side: "b" }),
    ];
    const resolutions = [resolution({ status: "confirmed", winnerSide: "a" })];

    assert.equal(outcome(participants, resolutions, "carol", true).kind, "none");
  });
});

describe("getBetOutcome -- multi-option bets", () => {
  test("the winning option sees 'won'", () => {
    const participants = [
      participant({ userId: "alice", amount: 10, optionId: "opt-red" }),
      participant({ userId: "bob", amount: 5, optionId: "opt-blue" }),
      participant({ userId: "carol", amount: 5, optionId: "opt-green" }),
    ];
    const resolutions = [resolution({ status: "confirmed", winnerOptionId: "opt-red" })];

    const result = outcome(participants, resolutions, "alice", false);
    assert.equal(result.kind, "won");
    assert.equal(result.amount, 20); // 10 + full share of the 10 losing pool
  });

  test("a non-winning option sees 'lost'", () => {
    const participants = [
      participant({ userId: "alice", amount: 10, optionId: "opt-red" }),
      participant({ userId: "bob", amount: 5, optionId: "opt-blue" }),
    ];
    const resolutions = [resolution({ status: "confirmed", winnerOptionId: "opt-red" })];

    const result = outcome(participants, resolutions, "bob", false);
    assert.equal(result.kind, "lost");
    assert.equal(result.amount, 5);
  });
});
