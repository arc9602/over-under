"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { uuidSchema, marketSideSchema } from "@/lib/validation/common";

export async function proposeMarketResolution(marketId: string, outcome: "yes" | "no") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsedId = uuidSchema.safeParse(marketId);
  const parsedOutcome = marketSideSchema.safeParse(outcome);
  if (!parsedId.success) return { error: "Market not found" };
  if (!parsedOutcome.success) return { error: "Invalid outcome" };

  // Trading must be halted first, otherwise someone could still be filling
  // orders while the outcome is being decided.
  const { data: market } = await supabase
    .from("markets")
    .select("id, status")
    .eq("id", parsedId.data)
    .single();

  if (!market || market.status !== "locked") {
    return { error: "Market must be locked before proposing a resolution" };
  }

  const { error } = await supabase
    .from("market_resolutions")
    .insert({
      market_id: parsedId.data,
      proposed_by: user.id,
      proposed_outcome: parsedOutcome.data,
    });

  if (error) return { error: error.message };

  const serviceClient = await createServiceClient();
  await serviceClient
    .from("markets")
    .update({ status: "resolving" })
    .eq("id", parsedId.data);

  revalidatePath(`/markets/${parsedId.data}`);
  return { success: true };
}

export async function confirmMarketResolution(resolutionId: string, marketId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsedResolutionId = uuidSchema.safeParse(resolutionId);
  const parsedMarketId = uuidSchema.safeParse(marketId);
  if (!parsedResolutionId.success || !parsedMarketId.success) {
    return { error: "Resolution not found" };
  }

  const serviceClient = await createServiceClient();
  const { error } = await serviceClient.rpc("confirm_market_resolution", {
    p_resolution_id: parsedResolutionId.data,
    p_confirmer_id: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/markets/${parsedMarketId.data}`);
  revalidatePath("/markets");
  revalidatePath("/balances");
  return { success: true };
}

export async function disputeMarketResolution(resolutionId: string, marketId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsedResolutionId = uuidSchema.safeParse(resolutionId);
  const parsedMarketId = uuidSchema.safeParse(marketId);
  if (!parsedResolutionId.success || !parsedMarketId.success) {
    return { error: "Resolution not found" };
  }

  const serviceClient = await createServiceClient();
  const { error } = await serviceClient.rpc("dispute_market_resolution", {
    p_resolution_id: parsedResolutionId.data,
    p_disputer_id: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/markets/${parsedMarketId.data}`);
  return { success: true };
}
