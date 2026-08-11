"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { multiOptionBetsEnabled } from "@/lib/features";
import { optionLabelsSchema } from "@/lib/validation/betOptions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const createBetSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(500).optional(),
    optionLabels: optionLabelsSchema,
    minWager: z.coerce.number().positive().max(100000).optional(),
    maxWager: z.coerce.number().positive().max(100000).optional(),
    deadline: z.string().optional(),
    creatorOptionIndex: z.coerce.number().int().min(0).optional(),
    creatorAmount: z.coerce.number().positive().max(100000).optional(),
  })
  .refine(
    (data) =>
      data.minWager == null ||
      data.maxWager == null ||
      data.minWager <= data.maxWager,
    {
      message: "Minimum wager can't exceed maximum wager",
      path: ["maxWager"],
    }
  )
  .refine(
    (data) =>
      (data.creatorOptionIndex == null && data.creatorAmount == null) ||
      (data.creatorOptionIndex != null && data.creatorAmount != null),
    {
      message: "Choose an option and amount together",
      path: ["creatorAmount"],
    }
  )
  .refine(
    (data) =>
      data.creatorOptionIndex == null ||
      data.creatorOptionIndex < data.optionLabels.length,
    {
      message: "Invalid creator option",
      path: ["creatorOptionIndex"],
    }
  );

export async function createBet(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const optionLabels = formData
    .getAll("optionLabels")
    .map(String)
    .map((label) => label.trim())
    .filter(Boolean);

  const parsed = createBetSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    optionLabels,
    minWager: formData.get("minWager") || undefined,
    maxWager: formData.get("maxWager") || undefined,
    deadline: formData.get("deadline") || undefined,
    creatorOptionIndex: formData.get("creatorOptionIndex") || undefined,
    creatorAmount: formData.get("creatorAmount") || undefined,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid form data",
    };
  }

  const {
    title,
    description,
    minWager,
    maxWager,
    deadline,
    creatorOptionIndex,
    creatorAmount,
  } = parsed.data;

  if (!multiOptionBetsEnabled()) {
    if (optionLabels.length !== 2) {
      return { error: "Exactly two options are currently enabled" };
    }

    const { data: bet, error } = await supabase
      .from("bets")
      .insert({
        title,
        description: description || null,
        side_a_label: optionLabels[0],
        side_b_label: optionLabels[1],
        min_wager: minWager ?? null,
        max_wager: maxWager ?? null,
        deadline: deadline ? new Date(deadline).toISOString() : null,
        creator_id: user.id,
      })
      .select("id")
      .single();

    if (error) return { error: error.message };

    if (creatorOptionIndex != null && creatorAmount) {
      const serviceClient = await createServiceClient();
      const { error: wagerError } = await serviceClient.rpc("place_wager", {
        p_bet_id: bet.id,
        p_user_id: user.id,
        p_side: creatorOptionIndex === 0 ? "a" : "b",
        p_amount: creatorAmount,
      });
      if (wagerError) return { error: wagerError.message };
    }

    revalidatePath("/dashboard");
    redirect(`/bets/${bet.id}`);
  }

  const { data: betId, error } = await supabase.rpc(
    "create_bet_with_options",
    {
      p_title: title,
      p_description: description || null,
      p_option_labels: optionLabels,
      p_min_wager: minWager ?? null,
      p_max_wager: maxWager ?? null,
      p_deadline: deadline ? new Date(deadline).toISOString() : null,
      p_creator_option_index: creatorOptionIndex ?? null,
      p_creator_amount: creatorAmount ?? null,
    }
  );

  if (error || !betId) {
    return { error: error?.message ?? "Unable to create bet" };
  }

  revalidatePath("/dashboard");
  redirect(`/bets/${betId}`);
}

export async function placeWager(
  identifier: { betId: string } | { inviteCode: string },
  optionId: string,
  amount: number
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const redirectTarget =
    "inviteCode" in identifier
      ? `/bet/${identifier.inviteCode}`
      : `/bets/${identifier.betId}`;
  if (!user) redirect(`/login?redirect=${encodeURIComponent(redirectTarget)}`);

  const serviceClient = await createServiceClient();
  const { data: bet } = await serviceClient
    .from("bets")
    .select("id")
    .match(
      "betId" in identifier
        ? { id: identifier.betId }
        : { invite_code: identifier.inviteCode }
    )
    .single();

  if (!bet) return { error: "Bet not found" };

  let error;
  if (multiOptionBetsEnabled()) {
    ({ error } = await supabase.rpc("place_option_wager", {
        p_bet_id: bet.id,
        p_option_id: optionId,
        p_amount: amount,
      }));
  } else {
    const optionCountResult = await serviceClient
      .from("bet_options")
      .select("id", { count: "exact", head: true })
      .eq("bet_id", bet.id);

    if (
      optionCountResult.error &&
      !["PGRST205", "42P01"].includes(optionCountResult.error.code)
    ) {
      return { error: optionCountResult.error.message };
    }
    if ((optionCountResult.count ?? 0) > 2) {
      return {
        error:
          "Multi-option betting is temporarily disabled; this wager was not changed",
      };
    }

    ({ error } = await serviceClient.rpc("place_wager", {
        p_bet_id: bet.id,
        p_user_id: user.id,
        p_side: optionId === "a" ? "a" : "b",
        p_amount: amount,
      }));
  }

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  revalidatePath(`/bets/${bet.id}`);
  redirect(`/bets/${bet.id}`);
}

export async function lockBet(betId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
    return {
      error:
        "Unable to lock this bet — it must have wagers on at least two options and you must be the creator",
    };
  }

  revalidatePath(`/bets/${betId}`);
  return { success: true };
}

export async function cancelBet(betId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
