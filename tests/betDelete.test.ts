/**
 * Unit tests for isBetDeletable -- the dashboard's client-side mirror of
 * delete_bet's (supabase/migrations/018_delete_bet.sql) eligibility gate.
 * This is exactly the surface a silent mistake would hurt: getting it wrong
 * in the permissive direction shows a delete control that the RPC then
 * rejects (annoying), but getting it wrong in the other direction hides a
 * legitimate delete -- less dangerous, but still worth pinning down.
 *
 *   node --test tests/
 *
 * Same conventions as betOutcome.test.ts: node:test, no new dependencies,
 * explicit .ts extension and a relative path -- Node's native TypeScript
 * stripping doesn't resolve extensionless specifiers or the "@/*" alias.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isBetDeletable } from "../lib/utils/betDelete.ts";

// Minimal fixture -- only the fields isBetDeletable reads.
function bet(overrides: {
  creatorId: string;
  status: string;
  participantUserIds?: string[];
}) {
  return {
    creator_id: overrides.creatorId,
    status: overrides.status as never,
    bet_participants: (overrides.participantUserIds ?? []).map((user_id) => ({ user_id })),
  };
}

describe("isBetDeletable", () => {
  test("the creator can delete a bet nobody else has joined", () => {
    const b = bet({ creatorId: "alice", status: "open" });
    assert.equal(isBetDeletable(b, "alice"), true);
  });

  test("the creator can delete a bet where only their own participant row exists", () => {
    // A creator who wagered on their own bet gets a bet_participants row
    // too -- that row must not itself count as "someone else joined".
    const b = bet({ creatorId: "alice", status: "active", participantUserIds: ["alice"] });
    assert.equal(isBetDeletable(b, "alice"), true);
  });

  test("not deletable once anyone besides the creator has a participant row", () => {
    const b = bet({ creatorId: "alice", status: "active", participantUserIds: ["alice", "bob"] });
    assert.equal(isBetDeletable(b, "alice"), false);
  });

  test("not deletable by anyone other than the creator, even with no other participants", () => {
    const b = bet({ creatorId: "alice", status: "open" });
    assert.equal(isBetDeletable(b, "bob"), false);
  });

  test("not deletable once resolved", () => {
    const b = bet({ creatorId: "alice", status: "resolved" });
    assert.equal(isBetDeletable(b, "alice"), false);
  });

  test("not deletable while resolving", () => {
    const b = bet({ creatorId: "alice", status: "resolving" });
    assert.equal(isBetDeletable(b, "alice"), false);
  });

  test("a cancelled bet the creator abandoned solo is still deletable -- cancel is not the same as gone", () => {
    const b = bet({ creatorId: "alice", status: "cancelled" });
    assert.equal(isBetDeletable(b, "alice"), true);
  });

  test("a stuck bet with no other participants is still deletable", () => {
    // 'stuck' isn't excluded by the rule -- only resolved/resolving are.
    const b = bet({ creatorId: "alice", status: "stuck" });
    assert.equal(isBetDeletable(b, "alice"), true);
  });
});
