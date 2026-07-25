"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function proposeResolution(betId: string, winnerSide: "a" | "b") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Verify bet is active
  const { data: bet } = await supabase
    .from("bets")
    .select("id, status")
    .eq("id", betId)
    .single();

  if (!bet || bet.status !== "active") {
    return { error: "Bet is not active" };
  }

  const { error } = await supabase
    .from("resolutions")
    .insert({
      bet_id: betId,
      proposed_by: user.id,
      proposed_winner_side: winnerSide,
    });

  if (error) return { error: error.message };

  const serviceClient = await createServiceClient();
  await serviceClient
    .from("bets")
    .update({ status: "resolving" })
    .eq("id", betId);

  revalidatePath(`/bets/${betId}`);
  return { success: true };
}

export async function confirmResolution(resolutionId: string, betId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const serviceClient = await createServiceClient();
  const { error } = await serviceClient.rpc("confirm_resolution", {
    p_resolution_id: resolutionId,
    p_confirmer_id: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/bets/${betId}`);
  revalidatePath("/dashboard");
  revalidatePath("/balances");
  return { success: true };
}

export async function disputeResolution(resolutionId: string, betId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const serviceClient = await createServiceClient();
  const { error } = await serviceClient.rpc("dispute_resolution", {
    p_resolution_id: resolutionId,
    p_disputer_id: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/bets/${betId}`);
  return { success: true };
}
