"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const markSettledSchema = z.object({
  friendId: z.uuid(),
  amount: z.coerce.number().positive().max(100000),
});

export async function markSettled(friendId: string, amount: number) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = markSettledSchema.safeParse({ friendId, amount });
  if (!parsed.success) return { error: "Invalid settlement amount" };

  // iou_ledger's RLS has no UPDATE policy at all -- it's service-role-only by
  // design (see its RLS comment in 002_rls_policies.sql). The regular client
  // used here previously meant this whole function silently did nothing:
  // every "Settle Up" recorded a settlements row but the underlying debt
  // never actually cleared. Reads are still scoped to `debtor_id = user.id`,
  // so a caller can only ever settle debt they themselves owe -- the service
  // client widens what RLS *would* block, not what this function allows.
  const serviceClient = await createServiceClient();

  // Same sliding-window limiter place_wager/place_market_order use
  // (migration 011) -- markSettled isn't itself a SECURITY DEFINER RPC, so
  // it calls the shared function directly instead of having it inlined.
  const { data: allowed, error: rateLimitError } = await serviceClient.rpc("check_rate_limit", {
    p_user_id: user.id,
    p_action: "mark_settled",
    p_max_count: 10,
    p_window_seconds: 60,
  });
  if (rateLimitError) return { error: rateLimitError.message };
  if (!allowed) return { error: "Too many settlements -- wait a moment and try again" };

  const { data: ious, error: iousError } = await serviceClient
    .from("iou_ledger")
    .select("id, amount")
    .eq("debtor_id", user.id)
    .eq("creditor_id", parsed.data.friendId)
    .eq("settled", false)
    .order("created_at", { ascending: true });

  if (iousError) return { error: iousError.message };

  const totalOwed = (ious ?? []).reduce((sum, iou) => sum + iou.amount, 0);
  // Compare in cents: amount arrives as a JS float, and NUMERIC(10,2) rows
  // shouldn't reject a payment that's off by a sub-cent rounding artifact.
  if (Math.round(parsed.data.amount * 100) > Math.round(totalOwed * 100)) {
    return { error: "That's more than you currently owe them" };
  }

  const { error: settlementError } = await serviceClient.from("settlements").insert({
    from_user_id: user.id,
    to_user_id: parsed.data.friendId,
    amount: parsed.data.amount,
  });
  // Bail before touching iou_ledger if the settlement record itself didn't
  // save -- otherwise debt could be marked settled with no record of why.
  if (settlementError) return { error: settlementError.message };

  // Record the payment on the double-entry ledger (migration 012). Paying
  // down debt *increases* the payer's own balance (they owe less) and
  // *decreases* the original creditor's (they're owed less) -- the reverse
  // of record_ledger_transaction's usual creditor/debtor framing, which is
  // exactly why that function names its params increase/decrease instead.
  // Unlike the whole-row limitation below, this correctly represents a
  // partial payment: the ledger's balance is the sum of every posting, so a
  // $30 payment against a $100 debt nets to -$70 without needing the debt
  // itself to be split or mutated.
  const { error: ledgerError } = await serviceClient.rpc("record_ledger_transaction", {
    p_kind: "debt_payment",
    p_bet_id: null,
    p_market_id: null,
    p_increase_user_id: user.id,
    p_decrease_user_id: parsed.data.friendId,
    p_amount: parsed.data.amount,
  });
  if (ledgerError) return { error: ledgerError.message };

  // Whole rows only, oldest first: an IOU is settled or it isn't, so a
  // partial payment against one large row can't be represented here and is
  // left unsettled even though the ledger transaction above already
  // recorded the payment correctly. This stays a known limitation of the
  // legacy iou_ledger.settled flag until a later pass moves /balances over
  // to reading ledger_balances instead.
  let remaining = parsed.data.amount;
  const toSettle: string[] = [];
  for (const iou of ious ?? []) {
    if (remaining <= 0) break;
    if (iou.amount <= remaining) {
      toSettle.push(iou.id);
      remaining -= iou.amount;
    }
  }

  if (toSettle.length > 0) {
    const { error: updateError } = await serviceClient
      .from("iou_ledger")
      .update({ settled: true, settled_at: new Date().toISOString() })
      .in("id", toSettle);
    if (updateError) return { error: updateError.message };
  }

  revalidatePath("/balances");
  return { success: true };
}
