"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { uuidSchema, betSideSchema } from "@/lib/validation/common";

export async function proposeResolution(betId: string, winnerSide: "a" | "b") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsedId = uuidSchema.safeParse(betId);
  const parsedSide = betSideSchema.safeParse(winnerSide);
  if (!parsedId.success) return { error: "Bet not found" };
  if (!parsedSide.success) return { error: "Invalid side" };

  // Verify bet is locked (creator has cut off new wagers)
  const { data: bet } = await supabase
    .from("bets")
    .select("id, status")
    .eq("id", parsedId.data)
    .single();

  if (!bet || bet.status !== "locked") {
    return { error: "Bet must be locked before proposing a resolution" };
  }

  const { error } = await supabase
    .from("resolutions")
    .insert({
      bet_id: parsedId.data,
      proposed_by: user.id,
      proposed_winner_side: parsedSide.data,
    });

  if (error) return { error: error.message };

  const serviceClient = await createServiceClient();
  await serviceClient
    .from("bets")
    .update({ status: "resolving" })
    .eq("id", parsedId.data);

  revalidatePath(`/bets/${parsedId.data}`);
  return { success: true };
}

/**
 * option_id-based counterpart of proposeResolution, for a bet with 3+
 * options. Goes through the propose_option_resolution RPC rather than a
 * plain RLS-scoped insert (like proposeResolution above uses) because it
 * also needs to verify the option belongs to this bet -- a cross-table
 * check that's simpler to express inside the function than as a RLS
 * WITH CHECK clause.
 */
export async function proposeOptionResolution(betId: string, winnerOptionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsedBetId = uuidSchema.safeParse(betId);
  const parsedOptionId = uuidSchema.safeParse(winnerOptionId);
  if (!parsedBetId.success || !parsedOptionId.success) {
    return { error: "Bet not found" };
  }

  const serviceClient = await createServiceClient();
  const { error } = await serviceClient.rpc("propose_option_resolution", {
    p_bet_id: parsedBetId.data,
    p_proposer_id: user.id,
    p_winner_option_id: parsedOptionId.data,
  });

  if (error) return { error: error.message };

  revalidatePath(`/bets/${parsedBetId.data}`);
  return { success: true };
}

export async function confirmOptionResolution(resolutionId: string, betId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsedResolutionId = uuidSchema.safeParse(resolutionId);
  const parsedBetId = uuidSchema.safeParse(betId);
  if (!parsedResolutionId.success || !parsedBetId.success) {
    return { error: "Resolution not found" };
  }

  const serviceClient = await createServiceClient();
  const { error } = await serviceClient.rpc("confirm_option_resolution", {
    p_resolution_id: parsedResolutionId.data,
    p_confirmer_id: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/bets/${parsedBetId.data}`);
  revalidatePath("/dashboard");
  revalidatePath("/balances");
  return { success: true };
}

// disputeOptionResolution intentionally doesn't exist: dispute_resolution's
// body never reads `side`, so the existing disputeResolution below already
// works unchanged for option-based resolutions too.

export async function confirmResolution(resolutionId: string, betId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsedResolutionId = uuidSchema.safeParse(resolutionId);
  const parsedBetId = uuidSchema.safeParse(betId);
  if (!parsedResolutionId.success || !parsedBetId.success) {
    return { error: "Resolution not found" };
  }

  const serviceClient = await createServiceClient();
  const { error } = await serviceClient.rpc("confirm_resolution", {
    p_resolution_id: parsedResolutionId.data,
    p_confirmer_id: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/bets/${parsedBetId.data}`);
  revalidatePath("/dashboard");
  revalidatePath("/balances");
  return { success: true };
}

export async function disputeResolution(resolutionId: string, betId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsedResolutionId = uuidSchema.safeParse(resolutionId);
  const parsedBetId = uuidSchema.safeParse(betId);
  if (!parsedResolutionId.success || !parsedBetId.success) {
    return { error: "Resolution not found" };
  }

  const serviceClient = await createServiceClient();
  const { error } = await serviceClient.rpc("dispute_resolution", {
    p_resolution_id: parsedResolutionId.data,
    p_disputer_id: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/bets/${parsedBetId.data}`);
  return { success: true };
}
