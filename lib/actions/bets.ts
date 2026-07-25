"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const createBetSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(500).optional(),
  sideALabel: z.string().min(1).max(50).default("Yes"),
  sideBLabel: z.string().min(1).max(50).default("No"),
  stake: z.coerce.number().positive().max(100000),
  deadline: z.string().optional(),
});

export async function createBet(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = createBetSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    sideALabel: formData.get("sideALabel"),
    sideBLabel: formData.get("sideBLabel"),
    stake: formData.get("stake"),
    deadline: formData.get("deadline") || undefined,
  });

  if (!parsed.success) {
    return { error: "Invalid form data", details: parsed.error.flatten() };
  }

  const { title, description, sideALabel, sideBLabel, stake, deadline } = parsed.data;

  const serviceClient = await createServiceClient();
  const { data, error } = await serviceClient.rpc("create_bet_with_participant", {
    p_title: title,
    p_description: description ?? null,
    p_side_a_label: sideALabel,
    p_side_b_label: sideBLabel,
    p_stake: stake,
    p_deadline: deadline ? new Date(deadline).toISOString() : null,
    p_creator_id: user.id,
  });

  if (error) return { error: error.message };

  const result = Array.isArray(data) ? data[0] : data;
  revalidatePath("/dashboard");
  redirect(`/bets/${result.bet_id}`);
}

export async function joinBet(inviteCode: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/bet/${inviteCode}`);

  const serviceClient = await createServiceClient();

  // Fetch the bet
  const { data: bet, error: betError } = await serviceClient
    .from("bets")
    .select("id, status")
    .eq("invite_code", inviteCode)
    .single();

  if (betError || !bet) return { error: "Bet not found" };
  if (bet.status !== "open") return { error: "This bet is no longer accepting participants" };

  // Check if already a participant
  const { data: existing } = await serviceClient
    .from("bet_participants")
    .select("id")
    .eq("bet_id", bet.id)
    .eq("user_id", user.id)
    .single();

  if (existing) {
    redirect(`/bets/${bet.id}`);
  }

  // Join as side B
  const { error: joinError } = await serviceClient
    .from("bet_participants")
    .insert({ bet_id: bet.id, user_id: user.id, side: "b" });

  if (joinError) {
    if (joinError.code === "23505") {
      return { error: "Someone just joined this bet ahead of you" };
    }
    return { error: joinError.message };
  }

  // Flip status to active
  await serviceClient
    .from("bets")
    .update({ status: "active" })
    .eq("id", bet.id);

  revalidatePath("/dashboard");
  redirect(`/bets/${bet.id}`);
}

export async function cancelBet(betId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("bets")
    .update({ status: "cancelled" })
    .eq("id", betId)
    .eq("creator_id", user.id)
    .eq("status", "open");

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  revalidatePath(`/bets/${betId}`);
  return { success: true };
}
