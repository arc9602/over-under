"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function proposeMarketResolution(marketId: string, outcome: "yes" | "no") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Trading must be halted first, otherwise someone could still be filling
  // orders while the outcome is being decided.
  const { data: market } = await supabase
    .from("markets")
    .select("id, status")
    .eq("id", marketId)
    .single();

  if (!market || market.status !== "locked") {
    return { error: "Market must be locked before proposing a resolution" };
  }

  const { error } = await supabase
    .from("market_resolutions")
    .insert({
      market_id: marketId,
      proposed_by: user.id,
      proposed_outcome: outcome,
    });

  if (error) return { error: error.message };

  const serviceClient = await createServiceClient();
  await serviceClient
    .from("markets")
    .update({ status: "resolving" })
    .eq("id", marketId);

  revalidatePath(`/markets/${marketId}`);
  return { success: true };
}

export async function confirmMarketResolution(resolutionId: string, marketId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const serviceClient = await createServiceClient();
  const { error } = await serviceClient.rpc("confirm_market_resolution", {
    p_resolution_id: resolutionId,
    p_confirmer_id: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/markets/${marketId}`);
  revalidatePath("/markets");
  revalidatePath("/balances");
  return { success: true };
}

export async function disputeMarketResolution(resolutionId: string, marketId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const serviceClient = await createServiceClient();
  const { error } = await serviceClient.rpc("dispute_market_resolution", {
    p_resolution_id: resolutionId,
    p_disputer_id: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/markets/${marketId}`);
  return { success: true };
}
