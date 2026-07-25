"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function markSettled(friendId: string, amount: number) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Determine who is creditor/debtor based on direction
  // We'll settle IOUs where user owes friendId (debtor = user, creditor = friend)
  const { data: ious, error } = await supabase
    .from("iou_ledger")
    .select("id, amount")
    .eq("debtor_id", user.id)
    .eq("creditor_id", friendId)
    .eq("settled", false)
    .order("created_at", { ascending: true });

  if (error) return { error: error.message };

  // Record the settlement
  await supabase.from("settlements").insert({
    from_user_id: user.id,
    to_user_id: friendId,
    amount,
  });

  // Mark IOUs as settled (oldest first, up to amount)
  let remaining = amount;
  const toSettle: string[] = [];
  for (const iou of ious ?? []) {
    if (remaining <= 0) break;
    if (iou.amount <= remaining) {
      toSettle.push(iou.id);
      remaining -= iou.amount;
    }
  }

  if (toSettle.length > 0) {
    await supabase
      .from("iou_ledger")
      .update({ settled: true, settled_at: new Date().toISOString() })
      .in("id", toSettle);
  }

  revalidatePath("/balances");
  return { success: true };
}
