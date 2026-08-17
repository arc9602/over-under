/**
 * Unit tests for debt-cycle simplification.
 *
 *   node --test tests/
 *
 * No test framework and no new dependencies: node:test is built in, and Node
 * 24 strips TypeScript types natively. Imports use explicit .ts extensions
 * because that native stripping does not resolve extensionless specifiers, and
 * relative paths because it does not read tsconfig's "@/*" alias either.
 *
 * The conservation invariant -- nobody's net position moves by a single cent
 * -- is checked on every scenario below via assertConserved, not just spot
 * checked once. That property, not the edge-count reduction, is the whole
 * reason cycle cancellation is safe to run against real IOUs.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  simplifyDebtCycles,
  netPositions,
  SimplifyDebtsError,
  type DebtEdge,
} from "../lib/utils/simplifyDebts.ts";

/**
 * Cancelling a cycle must never move a single cent of anyone's net worth.
 * Reconstructs the "after" graph from `before` minus `result.reductions` --
 * exactly what a caller applying the result would do -- rather than trusting
 * simplifyDebtCycles's own internal bookkeeping.
 */
function assertConserved(before: DebtEdge[], result: ReturnType<typeof simplifyDebtCycles>) {
  const beforeNet = netPositions(before);

  // Reductions are expressed against the netted graph, so net `before` first
  // (mirrors the module's own doc comment on `reductions`), then apply the
  // reductions on top to get the after-graph.
  const netted = new Map<string, number>(); // "debtor creditor" -> cents
  for (const e of before) {
    const key = `${e.debtorId} ${e.creditorId}`;
    netted.set(key, (netted.get(key) ?? 0) + e.cents);
  }
  // Collapse reverse pairs the same way the module does, so `afterEdges`
  // starts from the same netted baseline `reductions` is expressed against.
  const collapsed = new Map<string, number>();
  const seen = new Set<string>();
  for (const key of netted.keys()) {
    if (seen.has(key)) continue;
    const [a, b] = key.split(" ");
    const rev = `${b} ${a}`;
    seen.add(key);
    seen.add(rev);
    const diff = (netted.get(key) ?? 0) - (netted.get(rev) ?? 0);
    if (diff > 0) collapsed.set(key, diff);
    else if (diff < 0) collapsed.set(rev, -diff);
  }

  for (const r of result.reductions) {
    const key = `${r.debtorId} ${r.creditorId}`;
    collapsed.set(key, (collapsed.get(key) ?? 0) - r.cents);
  }

  const afterEdges: DebtEdge[] = [];
  for (const [key, cents] of collapsed) {
    if (cents > 0) {
      const [debtorId, creditorId] = key.split(" ");
      afterEdges.push({ debtorId, creditorId, cents });
    }
  }

  const afterNet = netPositions(afterEdges);
  const allUsers = new Set([...beforeNet.keys(), ...afterNet.keys()]);
  for (const user of allUsers) {
    assert.equal(
      afterNet.get(user) ?? 0,
      beforeNet.get(user) ?? 0,
      `net position of ${JSON.stringify(user)} changed: ${beforeNet.get(user) ?? 0} -> ${afterNet.get(user) ?? 0}`
    );
  }
}

describe("simplifyDebtCycles", () => {
  test("a simple 3-cycle of equal amounts cancels completely", () => {
    const debts: DebtEdge[] = [
      { debtorId: "A", creditorId: "B", cents: 1000 },
      { debtorId: "B", creditorId: "C", cents: 1000 },
      { debtorId: "C", creditorId: "A", cents: 1000 },
    ];
    const result = simplifyDebtCycles(debts);

    assert.equal(result.edgesBefore, 3);
    assert.equal(result.edgesAfter, 0);
    assert.equal(result.centsCancelled, 3000);
    assert.equal(result.reductions.length, 3);
    for (const r of result.reductions) assert.equal(r.cents, 1000);

    assertConserved(debts, result);
  });

  test("a 3-cycle with unequal amounts: only the smallest edge vanishes", () => {
    const debts: DebtEdge[] = [
      { debtorId: "A", creditorId: "B", cents: 1000 },
      { debtorId: "B", creditorId: "C", cents: 600 },
      { debtorId: "C", creditorId: "A", cents: 800 },
    ];
    const result = simplifyDebtCycles(debts);

    // Minimum along the cycle is 600 (B->C), so it fully cancels and the
    // other two shrink by 600 each.
    assert.equal(result.edgesBefore, 3);
    assert.equal(result.edgesAfter, 2);
    assert.equal(result.centsCancelled, 600 * 3);

    const byPair = new Map(result.reductions.map((r) => [`${r.debtorId}->${r.creditorId}`, r.cents]));
    assert.equal(byPair.get("A->B"), 600);
    assert.equal(byPair.get("B->C"), 600);
    assert.equal(byPair.get("C->A"), 600);

    assertConserved(debts, result);
  });

  test("mutual two-person debt nets to a single edge", () => {
    const debts: DebtEdge[] = [
      { debtorId: "A", creditorId: "B", cents: 900 },
      { debtorId: "B", creditorId: "A", cents: 400 },
    ];
    const result = simplifyDebtCycles(debts);

    assert.equal(result.edgesBefore, 1); // netting happens before edgesBefore is measured
    assert.equal(result.edgesAfter, 1);
    assert.equal(result.centsCancelled, 0); // no cycle to cancel, just netting
    assert.equal(result.reductions.length, 0);

    assertConserved(debts, result);

    // Confirm netPositions itself reflects the A->B 500 outcome directly.
    const net = netPositions(debts);
    assert.equal(net.get("A"), -500);
    assert.equal(net.get("B"), 500);
  });

  test("exactly equal mutual debt cancels both edges entirely", () => {
    const debts: DebtEdge[] = [
      { debtorId: "A", creditorId: "B", cents: 500 },
      { debtorId: "B", creditorId: "A", cents: 500 },
    ];
    const result = simplifyDebtCycles(debts);

    assert.equal(result.edgesBefore, 0); // net is zero, netting already removed both
    assert.equal(result.edgesAfter, 0);
    assert.equal(result.centsCancelled, 0);
    assert.equal(result.reductions.length, 0);

    assertConserved(debts, result);

    const net = netPositions(debts);
    assert.equal(net.get("A"), 0);
    assert.equal(net.get("B"), 0);
  });

  test("an already-acyclic chain is returned untouched", () => {
    const debts: DebtEdge[] = [
      { debtorId: "A", creditorId: "B", cents: 500 },
      { debtorId: "B", creditorId: "C", cents: 300 },
    ];
    const result = simplifyDebtCycles(debts);

    assert.equal(result.edgesBefore, 2);
    assert.equal(result.edgesAfter, 2);
    assert.equal(result.centsCancelled, 0);
    assert.deepEqual(result.reductions, []);

    assertConserved(debts, result);
  });

  test("multiple independent components simplify independently", () => {
    const debts: DebtEdge[] = [
      // Component 1: a 3-cycle that fully cancels.
      { debtorId: "A", creditorId: "B", cents: 200 },
      { debtorId: "B", creditorId: "C", cents: 200 },
      { debtorId: "C", creditorId: "A", cents: 200 },
      // Component 2: an unrelated chain, untouched.
      { debtorId: "X", creditorId: "Y", cents: 700 },
      { debtorId: "Y", creditorId: "Z", cents: 300 },
    ];
    const result = simplifyDebtCycles(debts);

    assert.equal(result.edgesBefore, 5);
    assert.equal(result.edgesAfter, 2); // only X->Y and Y->Z survive
    assert.equal(result.centsCancelled, 600);

    const byPair = new Map(result.reductions.map((r) => [`${r.debtorId}->${r.creditorId}`, r.cents]));
    assert.equal(byPair.get("A->B"), 200);
    assert.equal(byPair.get("B->C"), 200);
    assert.equal(byPair.get("C->A"), 200);
    assert.equal(byPair.has("X->Y"), false);
    assert.equal(byPair.has("Y->Z"), false);

    assertConserved(debts, result);
  });

  test("two overlapping cycles sharing an edge", () => {
    // Cycle 1: A -> B -> C -> A (B->C is the shared edge)
    // Cycle 2: B -> C -> D -> B
    const debts: DebtEdge[] = [
      { debtorId: "A", creditorId: "B", cents: 100 },
      { debtorId: "B", creditorId: "C", cents: 500 },
      { debtorId: "C", creditorId: "A", cents: 100 },
      { debtorId: "C", creditorId: "D", cents: 200 },
      { debtorId: "D", creditorId: "B", cents: 200 },
    ];
    const result = simplifyDebtCycles(debts);

    // Both cycles fully cancel: A->B->C->A drains B->C by 100 (leaving 400),
    // then B->C->D->B drains the remaining 400... but its own min is 200
    // (C->D and D->B), so that cycle only removes 200 from B->C, C->D, D->B.
    // Whichever cycle DFS finds first, the end state is order-independent
    // for edgesAfter/centsCancelled here since both A->C->A leg amounts (100)
    // and D leg amounts (200) are strictly smaller than the shared edge (500).
    assert.equal(result.edgesBefore, 5);
    assert.equal(result.edgesAfter, 1); // only B->C survives, shrunk
    assert.equal(result.edgesBefore - result.edgesAfter, 4);

    assertConserved(debts, result);
    assert.ok(result.edgesAfter <= result.edgesBefore);
  });

  test("empty input", () => {
    const result = simplifyDebtCycles([]);
    assert.equal(result.edgesBefore, 0);
    assert.equal(result.edgesAfter, 0);
    assert.equal(result.centsCancelled, 0);
    assert.deepEqual(result.reductions, []);
    assert.equal(netPositions([]).size, 0);
  });

  test("rejects zero cents", () => {
    assert.throws(
      () => simplifyDebtCycles([{ debtorId: "A", creditorId: "B", cents: 0 }]),
      SimplifyDebtsError
    );
  });

  test("rejects negative cents", () => {
    assert.throws(
      () => simplifyDebtCycles([{ debtorId: "A", creditorId: "B", cents: -100 }]),
      SimplifyDebtsError
    );
  });

  test("rejects non-integer cents", () => {
    assert.throws(
      () => simplifyDebtCycles([{ debtorId: "A", creditorId: "B", cents: 100.5 }]),
      SimplifyDebtsError
    );
  });

  test("rejects self-debt", () => {
    assert.throws(
      () => simplifyDebtCycles([{ debtorId: "A", creditorId: "A", cents: 100 }]),
      SimplifyDebtsError
    );
  });

  test("rejects empty debtorId/creditorId", () => {
    assert.throws(
      () => simplifyDebtCycles([{ debtorId: "", creditorId: "B", cents: 100 }]),
      SimplifyDebtsError
    );
    assert.throws(
      () => simplifyDebtCycles([{ debtorId: "A", creditorId: "", cents: 100 }]),
      SimplifyDebtsError
    );
  });

  test("edgesAfter never exceeds edgesBefore, across all fixed scenarios above", () => {
    const scenarios: DebtEdge[][] = [
      [
        { debtorId: "A", creditorId: "B", cents: 1000 },
        { debtorId: "B", creditorId: "C", cents: 1000 },
        { debtorId: "C", creditorId: "A", cents: 1000 },
      ],
      [
        { debtorId: "A", creditorId: "B", cents: 500 },
        { debtorId: "B", creditorId: "C", cents: 300 },
      ],
      [],
    ];
    for (const debts of scenarios) {
      const result = simplifyDebtCycles(debts);
      assert.ok(result.edgesAfter <= result.edgesBefore);
    }
  });
});

describe("simplifyDebtCycles: randomized property test", () => {
  /**
   * Tiny deterministic LCG (Numerical Recipes constants) so the suite is
   * reproducible across runs and machines -- Math.random() would make a
   * failing seed unreproducible, defeating the point of a property test.
   */
  function makeLcg(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0xffffffff;
    };
  }

  function randomGraph(rand: () => number, userCount: number, edgeCount: number): DebtEdge[] {
    const users = Array.from({ length: userCount }, (_, i) => `user${i}`);
    const edges: DebtEdge[] = [];
    let attempts = 0;
    while (edges.length < edgeCount && attempts < edgeCount * 10) {
      attempts++;
      const debtorId = users[Math.floor(rand() * users.length)];
      let creditorId = users[Math.floor(rand() * users.length)];
      if (debtorId === creditorId) continue; // no self-debt in generated input
      const cents = 1 + Math.floor(rand() * 5000);
      edges.push({ debtorId, creditorId, cents });
    }
    return edges;
  }

  function hasCycle(edges: DebtEdge[]): boolean {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (!adj.has(e.debtorId)) adj.set(e.debtorId, []);
      adj.get(e.debtorId)!.push(e.creditorId);
    }
    const WHITE = 0,
      GRAY = 1,
      BLACK = 2;
    const color = new Map<string, number>();

    function visit(node: string): boolean {
      color.set(node, GRAY);
      for (const next of adj.get(node) ?? []) {
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) return true;
        if (c === WHITE && visit(next)) return true;
      }
      color.set(node, BLACK);
      return false;
    }

    for (const node of adj.keys()) {
      if ((color.get(node) ?? WHITE) === WHITE && visit(node)) return true;
    }
    return false;
  }

  test("random graphs: conservation, acyclicity, positivity, bounded reductions", () => {
    const rand = makeLcg(0xc0ffee);
    const trials = 200;

    for (let trial = 0; trial < trials; trial++) {
      const userCount = 2 + Math.floor(rand() * 6); // 2..7 users
      const edgeCount = 1 + Math.floor(rand() * 15); // 1..15 raw edges
      const debts = randomGraph(rand, userCount, edgeCount);
      if (debts.length === 0) continue;

      const result = simplifyDebtCycles(debts);

      // (a) net positions preserved exactly.
      assertConserved(debts, result);

      // (d) no reduction exceeds the netted edge it applies to.
      const netted = new Map<string, number>();
      for (const e of debts) {
        const key = `${e.debtorId} ${e.creditorId}`;
        netted.set(key, (netted.get(key) ?? 0) + e.cents);
      }
      const collapsed = new Map<string, number>();
      const seen = new Set<string>();
      for (const key of netted.keys()) {
        if (seen.has(key)) continue;
        const [a, b] = key.split(" ");
        const rev = `${b} ${a}`;
        seen.add(key);
        seen.add(rev);
        const diff = (netted.get(key) ?? 0) - (netted.get(rev) ?? 0);
        if (diff > 0) collapsed.set(key, diff);
        else if (diff < 0) collapsed.set(rev, -diff);
      }
      for (const r of result.reductions) {
        const key = `${r.debtorId} ${r.creditorId}`;
        const nettedAmount = collapsed.get(key) ?? 0;
        assert.ok(
          r.cents <= nettedAmount,
          `trial ${trial}: reduction ${r.cents} on ${key} exceeds netted edge ${nettedAmount}`
        );
        assert.ok(r.cents > 0, `trial ${trial}: reduction on ${key} is not positive`);
      }

      // (c) every remaining edge (netted minus reductions) has positive cents,
      // and (b) the resulting graph has no cycles.
      const afterEdges: DebtEdge[] = [];
      for (const [key, before] of collapsed) {
        const reduced = result.reductions.find((r) => `${r.debtorId} ${r.creditorId}` === key)?.cents ?? 0;
        const after = before - reduced;
        assert.ok(after >= 0, `trial ${trial}: edge ${key} went negative (${after})`);
        if (after > 0) {
          const [debtorId, creditorId] = key.split(" ");
          afterEdges.push({ debtorId, creditorId, cents: after });
        }
      }
      assert.equal(afterEdges.length, result.edgesAfter, `trial ${trial}: edgesAfter mismatch`);
      assert.equal(hasCycle(afterEdges), false, `trial ${trial}: result graph still has a cycle`);

      assert.ok(result.edgesAfter <= result.edgesBefore, `trial ${trial}: edgesAfter exceeds edgesBefore`);
    }
  });
});

describe("netPositions", () => {
  test("sums to zero across all users for any valid graph", () => {
    const debts: DebtEdge[] = [
      { debtorId: "A", creditorId: "B", cents: 500 },
      { debtorId: "B", creditorId: "C", cents: 300 },
      { debtorId: "C", creditorId: "A", cents: 100 },
    ];
    const net = netPositions(debts);
    let total = 0;
    for (const v of net.values()) total += v;
    assert.equal(total, 0);
  });

  test("rejects invalid edges the same way simplifyDebtCycles does", () => {
    assert.throws(() => netPositions([{ debtorId: "A", creditorId: "A", cents: 100 }]), SimplifyDebtsError);
    assert.throws(() => netPositions([{ debtorId: "A", creditorId: "B", cents: -1 }]), SimplifyDebtsError);
  });
});
