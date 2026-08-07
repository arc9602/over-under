"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const createBetSchema = z
  .object({
    title: z.string().min(3).max(200),
    description: z.string().max(500).optional(),
    optionLabels: z.array(z.string().trim().min(1).max(50)).min(2).max(10),
    minWager: z.coerce.number().positive().max(100000).optional(),
    maxWager: z.coerce.number().positive().max(100000).optional(),
    deadline: z.string().optional(),
    creatorOptionIndex: z.coerce.number().int().min(0).optional(),
    creatorAmount: z.coerce.number().positive().max(100000).optional(),
  })
  .refine((d) => (d.minWager == null || d.maxWager == null) || d.minWager <= d.maxWager, {
    message: "Minimum wager can't exceed maximum wager",
    path: ["maxWager"],
  })
  .refine(
    (d) =>
      (d.creatorOptionIndex == null && d.creatorAmount == null) ||
      (d.creatorOptionIndex != null && d.creatorAmount != null),
    {
      message: "Choose an option and an amount to wager now, or leave both blank",
      path: ["creatorAmount"],
    }
  )
  .refine(
    (d) =>
      d.creatorOptionIndex == null ||
      d.creatorOptionIndex < d.optionLabels.length,
    {
      message: "Invalid option selected for creator wager",
      path: ["creatorOptionIndex"],
    }
  );

export async function createBet(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const optionLabels = formData.getAll("optionLabels").map(String).filter(Boolean);

  const parsed = createBetSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    optionLabels,
    minWager: formData.get("minWager") || undefined,
    maxWager: formData.get("maxWager") || undefined,
    deadline: formData.get("deadline") || undefined,
    creatorOptionIndex: formData.get("creatorOptionIndex") || undefined,
    creatorAmount: formData.get("creatorAmount") || undefined,
  });

  if (!parsed.success) {
    return { error: "Invalid form data", details: parsed.error.flatten() };
  }

  const {
    title, description, minWager, maxWager, deadline,
    creatorOptionIndex, creatorAmount,
  } = parsed.data;

  const { data: bet, error } = await supabase
    .from("bets")
    .insert({
      title,
      description: description ?? null,
      min_wager: minWager ?? null,
      max_wager: maxWager ?? null,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      creator_id: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  const { data: options, error: optionsError } = await supabase
    .from("bet_options")
    .insert(
      optionLabels.map((label, index) => ({
        bet_id: bet.id,
        label,
        sort_order: index,
      }))
    )
    .select("id, sort_order");

  if (optionsError || !options?.length) {
    return { error: optionsError?.message ?? "Failed to create bet options" };
  }

  if (creatorOptionIndex != null && creatorAmount) {
    const creatorOption = options.find((o) => o.sort_order === creatorOptionIndex);
    if (creatorOption) {
      const serviceClient = await createServiceClient();
      await serviceClient.rpc("place_wager", {
        p_bet_id: bet.id,
        p_user_id: user.id,
        p_option_id: creatorOption.id,
        p_amount: creatorAmount,
      });
    }
  }

  revalidatePath("/dashboard");
  redirect(`/bets/${bet.id}`);
}

export async function placeWager(
  identifier: { betId: string } | { inviteCode: string },
  optionId: string,
  amount: number
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const redirectTarget = "inviteCode" in identifier ? `/bet/${identifier.inviteCode}` : `/bets/${identifier.betId}`;
  if (!user) redirect(`/login?redirect=${encodeURIComponent(redirectTarget)}`);

  const serviceClient = await createServiceClient();
  const { data: bet } = await serviceClient
    .from("bets")
    .select("id")
    .match("betId" in identifier ? { id: identifier.betId } : { invite_code: identifier.inviteCode })
    .single();

  if (!bet) return { error: "Bet not found" };

  const { error } = await serviceClient.rpc("place_wager", {
    p_bet_id: bet.id,
    p_user_id: user.id,
    p_option_id: optionId,
    p_amount: amount,
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  revalidatePath(`/bets/${bet.id}`);
  redirect(`/bets/${bet.id}`);
}

export async function lockBet(betId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("bets")
    .update({ status: "locked" })
    .eq("id", betId)
    .eq("creator_id", user.id)
    .eq("status", "active")
    .select("id")
    .single();

  if (error || !data) {
    return { error: "Unable to lock this bet -- it must be funded on at least two options and you must be the creator" };
  }

  revalidatePath(`/bets/${betId}`);
  return { success: true };
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
    .in("status", ["open", "active"]);

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  revalidatePath(`/bets/${betId}`);
  return { success: true };
}
