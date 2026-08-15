/**
 * Unit tests for getUserPoolHistory -- the fix for BetWagerChart's "always
 * trends toward a win" bug. Every point used to be built from the user's own
 * side (`side === mine.side`) with no reference to who actually won, so a
 * bet the user LOST still charted a rising profit line. This mirrors the
 * getBetOutcome fix in tests/betOutcome.test.ts: the caller was asking the
 * function the wrong question (BetDetail.tsx passing `mine.side` instead of
 * the confirmed resolution's winner -- see commit c2b7896 for the same shape
 * of bug in BetCard).
 *
 *   node --test tests/
 *
 * Same conventions as betOutcome.test.ts: node:test, no new dependencies,
 * explicit .ts extensions and relative paths -- Node's native type stripping
 * resolves neither extensionless specifiers nor tsconfig's "@/*" alias.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { getUserPoolHistory } from "../lib/utils/betPool.ts";

// Minimal fixtures -- only the fields getUserPoolHistory reads (side, amount,
// user_id, joined_at). `profiles` is never touched by this logic.
function participant(p: {
  userId: string;
  amount: number;
  side: "a" | "b";
  joinedAt: string;
}) {
  return {
    id: p.userId,
    bet_id: "bet-1",
    user_id: p.userId,
    side: p.side,
    option_id: null,
    amount: p.amount,
    joined_at: p.joinedAt,
    profiles: {},
  };
}

const history = getUserPoolHistory as unknown as (
  participants: ReturnType<typeof participant>[],
  userId: string,
  winnerSide?: "a" | "b" | null
) => {
  points: { timestamp: number; currentOdds: number; projectedPayout: number; wager: number; pnl: number }[];
  side: "a" | "b" | null;
  referenceOdds: number | null;
};

describe("getUserPoolHistory -- live bet (no winnerSide passed)", () => {
  test("projects toward the user's own side winning, unchanged from before this parameter existed", () => {
    const participants = [
      participant({ userId: "alice", amount: 10, side: "a", joinedAt: "2026-01-01T00:00:00Z" }),
      participant({ userId: "bob", amount: 10, side: "b", joinedAt: "2026-01-02T00:00:00Z" }),
    ];

    const result = history(participants, "alice");
    assert.equal(result.side, "a");
    assert.equal(result.points.length, 2);
    // At alice's own entry the pool is just her 10 on "a" -- no opposing
    // money yet, so projected payout is exactly her stake back.
    assert.equal(result.points[0].projectedPayout, 10);
    assert.equal(result.points[0].pnl, 0);
    // Once bob's 10 lands on "b", alice's projection (if "a" wins) rises to
    // her stake plus the full opposing pool.
    assert.equal(result.points[1].projectedPayout, 20);
    assert.equal(result.points[1].pnl, 10);
  });

  test("explicit null also means live -- same as omitting the argument", () => {
    const participants = [
      participant({ userId: "alice", amount: 10, side: "a", joinedAt: "2026-01-01T00:00:00Z" }),
      participant({ userId: "bob", amount: 10, side: "b", joinedAt: "2026-01-02T00:00:00Z" }),
    ];

    const omitted = history(participants, "alice");
    const explicitNull = history(participants, "alice", null);
    assert.deepEqual(explicitNull, omitted);
  });
});

describe("getUserPoolHistory -- settled and won", () => {
  test("matches the live projection exactly once the user's side is confirmed the winner", () => {
    const participants = [
      participant({ userId: "alice", amount: 10, side: "a", joinedAt: "2026-01-01T00:00:00Z" }),
      participant({ userId: "bob", amount: 10, side: "b", joinedAt: "2026-01-02T00:00:00Z" }),
    ];

    const live = history(participants, "alice");
    const settledWon = history(participants, "alice", "a");
    assert.deepEqual(settledWon, live);
    assert.equal(settledWon.points[1].projectedPayout, 20);
    assert.equal(settledWon.points[1].pnl, 10);
  });
});

describe("getUserPoolHistory -- settled and lost", () => {
  test("every point is a clean loss: projectedPayout 0, pnl -wager -- the bug this replaces", () => {
    const participants = [
      participant({ userId: "alice", amount: 10, side: "a", joinedAt: "2026-01-01T00:00:00Z" }),
      participant({ userId: "bob", amount: 10, side: "b", joinedAt: "2026-01-02T00:00:00Z" }),
      participant({ userId: "carol", amount: 5, side: "a", joinedAt: "2026-01-03T00:00:00Z" }),
    ];

    // Side "a" is confirmed the winner -- bob (on "b") lost. His own chart
    // must show a flat, real loss throughout, not a rising "profit" line
    // toward a win that never happened.
    const result = history(participants, "bob", "a");
    assert.equal(result.side, "b");
    assert.ok(result.points.length > 0);
    for (const point of result.points) {
      assert.equal(point.projectedPayout, 0);
      assert.equal(point.pnl, -10);
      assert.equal(point.wager, 10);
    }
  });

  test("currentOdds and referenceOdds are untouched by the loss -- they describe pool history, not the outcome", () => {
    const participants = [
      participant({ userId: "alice", amount: 10, side: "a", joinedAt: "2026-01-01T00:00:00Z" }),
      participant({ userId: "bob", amount: 30, side: "b", joinedAt: "2026-01-02T00:00:00Z" }),
    ];

    const live = history(participants, "alice");
    const settledLost = history(participants, "alice", "b");
    assert.equal(settledLost.referenceOdds, live.referenceOdds);
    assert.deepEqual(
      settledLost.points.map((p) => p.currentOdds),
      live.points.map((p) => p.currentOdds)
    );
  });
});

describe("getUserPoolHistory -- non-participant", () => {
  test("empty points, null side, null referenceOdds -- regardless of a winner being passed", () => {
    const participants = [
      participant({ userId: "alice", amount: 10, side: "a", joinedAt: "2026-01-01T00:00:00Z" }),
    ];

    const result = history(participants, "carol", "a");
    assert.deepEqual(result.points, []);
    assert.equal(result.side, null);
    assert.equal(result.referenceOdds, null);
  });
});

describe("getUserPoolHistory -- winner against an empty losing pool", () => {
  test("profit is a clean 0, not NaN or a divide-by-zero", () => {
    const participants = [
      participant({ userId: "alice", amount: 10, side: "a", joinedAt: "2026-01-01T00:00:00Z" }),
    ];

    const result = history(participants, "alice", "a");
    assert.equal(result.points.length, 1);
    assert.equal(result.points[0].projectedPayout, 10);
    assert.equal(result.points[0].pnl, 0);
    assert.ok(Number.isFinite(result.points[0].projectedPayout));
  });
});
