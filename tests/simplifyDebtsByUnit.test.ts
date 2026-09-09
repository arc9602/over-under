/**
 * Unit tests for per-unit debt-cycle simplification.
 *
 *   node --test tests/
 *
 * Companion to simplifyDebts.test.ts, which covers the cancellation algorithm
 * itself. This file covers only the rule that algorithm is deliberately kept
 * unaware of: a cycle can never span units.
 *
 * Bets can be staked in money or in anything else -- a slice of pizza, a beer
 * (migration 022). "A owes B $10, B owes C 3 slices, C owes A $10" traces a
 * loop in the graph but is not a cancellable one: subtracting the smallest
 * edge from every edge along it would take slices out of dollar debts, and
 * somebody ends up short having been paid nothing. simplifyDebtCyclesByUnit
 * partitions first so that shape is unreachable.
 *
 * Every scenario below uses three-person loops with no reverse pairs. That is
 * deliberate: two-person mutual debt is netted away inside collapseToNetGraph
 * before reductions are measured, so it yields no reductions at all (see
 * "exactly equal mutual debt cancels both edges entirely" in
 * simplifyDebts.test.ts). Using loops keeps `netted === raw`, which is what
 * lets applyReductions below subtract straight from the input graph.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  simplifyDebtCyclesByUnit,
  netPositions,
  SimplifyDebtsError,
  type UnitDebtEdge,
} from "../lib/utils/simplifyDebts.ts";

const USD = "USD";
const PIZZA = "slice of pizza";

/** Net position per (user, unit) -- the invariant 022's RPC re-checks in SQL. */
function netByUnit(debts: UnitDebtEdge[]): Map<string, number> {
  const perUnit = new Map<string, UnitDebtEdge[]>();
  for (const e of debts) {
    const g = perUnit.get(e.unit) ?? [];
    g.push(e);
    perUnit.set(e.unit, g);
  }
  const out = new Map<string, number>();
  for (const [unit, edges] of perUnit) {
    for (const [user, net] of netPositions(edges)) out.set(`${user}|${unit}`, net);
  }
  return out;
}

/** Apply the plan's reductions to the graph. Valid only when netted === raw. */
function applyReductions(debts: UnitDebtEdge[], reductions: UnitDebtEdge[]): UnitDebtEdge[] {
  const remaining = debts.map((e) => ({ ...e }));
  for (const r of reductions) {
    let left = r.cents;
    for (const e of remaining) {
      if (left <= 0) break;
      if (e.debtorId !== r.debtorId || e.creditorId !== r.creditorId || e.unit !== r.unit) continue;
      const take = Math.min(e.cents, left);
      e.cents -= take;
      left -= take;
    }
    assert.equal(left, 0, `reduction exceeded available debt: ${JSON.stringify(r)}`);
  }
  return remaining.filter((e) => e.cents > 0);
}

function assertConservedPerUnit(before: UnitDebtEdge[], after: UnitDebtEdge[]) {
  const b = netByUnit(before);
  const a = netByUnit(after);
  for (const k of new Set([...b.keys(), ...a.keys()])) {
    assert.equal(a.get(k) ?? 0, b.get(k) ?? 0, `net position moved for ${k}`);
  }
}

function loop(unit: string, cents: number, ids = ["A", "B", "C"]): UnitDebtEdge[] {
  return ids.map((id, i) => ({
    debtorId: id,
    creditorId: ids[(i + 1) % ids.length],
    cents,
    unit,
  }));
}

describe("simplifyDebtCyclesByUnit", () => {
  test("cancels a three-person loop inside a single unit", () => {
    const debts = loop(USD, 1000);
    const plan = simplifyDebtCyclesByUnit(debts);

    assert.equal(plan.edgesAfter, 0, "the whole loop should vanish");
    assert.equal(plan.centsCancelled, 3000);
    assert.ok(plan.reductions.every((r) => r.unit === USD));
    assertConservedPerUnit(debts, applyReductions(debts, plan.reductions));
  });

  test("does NOT cancel a loop that only closes by crossing units", () => {
    // A -> B in dollars, B -> C in pizza, C -> A in dollars. Traces a cycle in
    // a unit-blind graph; is not one here.
    const debts: UnitDebtEdge[] = [
      { debtorId: "A", creditorId: "B", cents: 1000, unit: USD },
      { debtorId: "B", creditorId: "C", cents: 300, unit: PIZZA },
      { debtorId: "C", creditorId: "A", cents: 1000, unit: USD },
    ];
    const plan = simplifyDebtCyclesByUnit(debts);

    assert.equal(plan.reductions.length, 0, "nothing is cancellable across units");
    assert.equal(plan.centsCancelled, 0);
    assert.equal(plan.edgesAfter, plan.edgesBefore);
  });

  test("each unit simplifies independently in a mixed graph", () => {
    const debts = [...loop(USD, 1000), ...loop(PIZZA, 200)];
    const plan = simplifyDebtCyclesByUnit(debts);

    assert.equal(plan.edgesAfter, 0, "both loops cancel");
    assert.equal(plan.centsCancelled, 3600, "3000c of USD + 600c of pizza");
    assert.deepEqual(
      [...new Set(plan.reductions.map((r) => r.unit))].sort(),
      [USD, PIZZA].sort()
    );
    assertConservedPerUnit(debts, applyReductions(debts, plan.reductions));
  });

  test("a unit that cannot simplify is left alone while another does", () => {
    const pizzaDebt: UnitDebtEdge = {
      debtorId: "A", creditorId: "B", cents: 200, unit: PIZZA,
    };
    const debts = [...loop(USD, 1000), pizzaDebt];
    const plan = simplifyDebtCyclesByUnit(debts);

    assert.ok(plan.reductions.every((r) => r.unit === USD), "pizza must be untouched");
    const after = applyReductions(debts, plan.reductions);
    assert.deepEqual(after, [pizzaDebt], "the one-way pizza debt survives intact");
    assertConservedPerUnit(debts, after);
  });

  test("reductions are ordered deterministically by unit", () => {
    const debts = [...loop(PIZZA, 200), ...loop(USD, 1000)];
    const first = simplifyDebtCyclesByUnit(debts).reductions.map((r) => r.unit);

    const shuffled = [debts[3], debts[0], debts[4], debts[1], debts[5], debts[2]];
    const second = simplifyDebtCyclesByUnit(shuffled).reductions.map((r) => r.unit);

    assert.deepEqual(first, second, "input order must not change the plan's order");
    assert.deepEqual(first, [...first].sort(), "units are visited in sorted order");
  });

  test("rejects an edge with no unit", () => {
    assert.throws(
      () => simplifyDebtCyclesByUnit([
        { debtorId: "A", creditorId: "B", cents: 100, unit: "" },
      ]),
      SimplifyDebtsError
    );
  });

  test("still rejects the malformed edges the underlying algorithm rejects", () => {
    assert.throws(
      () => simplifyDebtCyclesByUnit([
        { debtorId: "A", creditorId: "A", cents: 100, unit: USD },
      ]),
      SimplifyDebtsError
    );
    assert.throws(
      () => simplifyDebtCyclesByUnit([
        { debtorId: "A", creditorId: "B", cents: 0, unit: USD },
      ]),
      SimplifyDebtsError
    );
  });

  test("empty input", () => {
    assert.deepEqual(simplifyDebtCyclesByUnit([]), {
      reductions: [],
      edgesBefore: 0,
      edgesAfter: 0,
      centsCancelled: 0,
    });
  });
});
