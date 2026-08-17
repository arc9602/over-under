"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { simplifyDebtCycles, type DebtEdge, type SimplifyResult } from "@/lib/utils/simplifyDebts";

/**
 * Cycle-cancellation for the whole app's debt graph -- see migration 019's
 * header for what this buys (fewer payments, nobody's net position moves,
 * nobody is routed to a new counterparty) and lib/utils/simplifyDebts.ts for
 * the algorithm itself. This file only wires that algorithm and that
 * migration into the server actions the /balances page calls.
 *
 * ------------------------------------------------------------------------
 * PRIVACY. Read this before changing anything below.
 * ------------------------------------------------------------------------
 * iou_ledger's RLS only exposes rows where the caller is creditor or debtor,
 * so a loop A->B->C->A is invisible to any single participant's own client --
 * A can see A->B and C->A but not B->C. Finding the cycle at all requires the
 * service client, which bypasses RLS and sees every user's debts.
 *
 * That makes this the one place in the app where a server action holds the
 * entire debt graph in memory, for every user, on every call. It must NEVER
 * hand any of that back to the browser. Concretely:
 *   - Never return another user's id, username, or debt amount. Not even to
 *     the caller who triggered the run.
 *   - Return ONLY counts and totals that concern the caller (their own debts
 *     affected, their own cents cancelled), plus global counts that identify
 *     no one ("3 loops cancelled", "5 payments removed").
 *   - Never let a raw Postgres error reach the client. simplify_debt_cycles'
 *     exception messages interpolate other users' UUIDs (see 019's "Debt
 *     from % to % changed..."), so any error from the RPC or from the reads
 *     below is logged with console.error and replaced with a generic
 *     message before it leaves this file -- same rule lib/api/session.ts's
 *     apiError enforces for the API routes.
 * A future edit that adds a field to either return type is the most likely
 * way this gets broken. If it is not a count or a total the caller already
 * owns, it does not belong in the response.
 */

/**
 * Reads every unsettled IOU in the system via the service client (the only
 * client that can see the full graph -- see the privacy note above) and runs
 * it through the same cycle-cancellation algorithm both actions need.
 * Shared so preview and apply can never disagree about what a "cycle" is.
 *
 * Cents, not floats: iou_ledger.amount is NUMERIC(10,2), and
 * Math.round(amount * 100) is the exact conversion lib/actions/balances.ts's
 * markSettled already uses at this same boundary. simplifyDebtCycles refuses
 * anything that isn't an integer, so a float here would fail loudly rather
 * than silently drift.
 */
async function computeSimplificationPlan(
  serviceClient: Awaited<ReturnType<typeof createServiceClient>>
): Promise<SimplifyResult> {
  const { data, error } = await serviceClient
    .from("iou_ledger")
    .select("creditor_id, debtor_id, amount")
    .eq("settled", false);

  if (error) throw error;

  const edges: DebtEdge[] = (data ?? []).map((row) => ({
    debtorId: row.debtor_id,
    creditorId: row.creditor_id,
    cents: Math.round(row.amount * 100),
  }));

  return simplifyDebtCycles(edges);
}

export type PreviewSimplificationResult =
  | {
      pairsReduced: number;
      paymentsRemoved: number;
      yourDebtsAffected: number;
      centsCancelledForYou: number;
    }
  | { error: string };

/**
 * Computes what a run would do without changing anything. The UI uses an
 * all-zero result (reductions empty) to hide itself entirely -- see
 * SimplifyDebtsCard, which renders nothing when paymentsRemoved <= 0.
 *
 * User-triggered now (a click on /balances, not every page render -- see the
 * comment in app/(app)/balances/page.tsx), which turns this from "runs once
 * per view regardless of what anyone does" into "a button anyone can mash to
 * make the server re-scan the whole debt graph." Rate-limited the same way
 * markSettled is in lib/actions/balances.ts: check_rate_limit through the
 * service client, called directly since this isn't a SECURITY DEFINER RPC.
 * applySimplification doesn't need its own limit -- 019's RPC already rate
 * limits itself.
 */
export async function previewSimplification(): Promise<PreviewSimplificationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  try {
    const serviceClient = await createServiceClient();

    const { data: allowed, error: rateLimitError } = await serviceClient.rpc(
      "check_rate_limit",
      {
        p_user_id: user.id,
        p_action: "simplify_preview",
        p_max_count: 10,
        p_window_seconds: 60,
      }
    );
    if (rateLimitError) {
      console.error("[simplifyDebts] rate limit check failed", rateLimitError);
      return { error: "Couldn't check for simplifiable debts right now" };
    }
    if (!allowed) {
      return { error: "Too many checks -- wait a moment and try again" };
    }

    const plan = await computeSimplificationPlan(serviceClient);

    if (plan.reductions.length === 0) {
      return { pairsReduced: 0, paymentsRemoved: 0, yourDebtsAffected: 0, centsCancelledForYou: 0 };
    }

    // One reduction is one creditor-debtor pair whose debt shrank -- not one
    // loop, since a three-person loop reduces three pairs. This is the same
    // thing the RPC counts into debt_simplifications.pairs_reduced, so a
    // preview and the row written after applying it are directly comparable.
    // Deliberately not surfaced as "loops found" anywhere in the UI, which
    // talks in payments removed instead.
    const yours = plan.reductions.filter(
      (r) => r.debtorId === user.id || r.creditorId === user.id
    );

    return {
      pairsReduced: plan.reductions.length,
      paymentsRemoved: plan.edgesBefore - plan.edgesAfter,
      yourDebtsAffected: yours.length,
      centsCancelledForYou: yours.reduce((sum, r) => sum + r.cents, 0),
    };
  } catch (error) {
    // See the privacy note at the top of this file: nothing from `error`
    // (which may name other users' rows) is allowed past this line.
    console.error("[simplifyDebts] preview failed", error);
    return { error: "Couldn't check for simplifiable debts right now" };
  }
}

export type ApplySimplificationResult =
  | { success: true; paymentsRemoved: number; centsCancelledForYou: number }
  | { error: string };

/**
 * Recomputes the plan (never trusts one handed up from the client -- there
 * isn't one; the client only ever sees the preview's counts) and applies it
 * through migration 019's RPC, which re-validates and atomically rolls back
 * if anyone's net position would move.
 */
export async function applySimplification(): Promise<ApplySimplificationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  try {
    const serviceClient = await createServiceClient();
    const plan = await computeSimplificationPlan(serviceClient);

    // 019 raises on an empty reductions array -- checked here first so that
    // case reads as "nothing to do" instead of a server error.
    if (plan.reductions.length === 0) {
      return { error: "Nothing to simplify right now" };
    }

    const yours = plan.reductions.filter(
      (r) => r.debtorId === user.id || r.creditorId === user.id
    );
    const centsCancelledForYou = yours.reduce((sum, r) => sum + r.cents, 0);

    // Field names are the contract 019 parses off the JSONB array --
    // `debtor`/`creditor`/`cents`, not the camelCase DebtEdge fields above.
    const { error } = await serviceClient.rpc("simplify_debt_cycles", {
      p_user_id: user.id,
      p_reductions: plan.reductions.map((r) => ({
        debtor: r.debtorId,
        creditor: r.creditorId,
        cents: r.cents,
      })),
    });

    if (error) {
      console.error("[simplifyDebts] apply failed", error);
      // The one exception message worth distinguishing: it means someone
      // settled or created debt mid-run, so the plan is stale but trying
      // again is the correct, actionable response -- not a real failure.
      if (/changed while simplifying/i.test(error.message)) {
        return { error: "Balances changed while simplifying -- please try again" };
      }
      return { error: "Couldn't simplify debts right now" };
    }

    revalidatePath("/balances");
    revalidatePath("/dashboard");

    return {
      success: true,
      paymentsRemoved: plan.edgesBefore - plan.edgesAfter,
      centsCancelledForYou,
    };
  } catch (error) {
    console.error("[simplifyDebts] apply failed", error);
    return { error: "Couldn't simplify debts right now" };
  }
}
