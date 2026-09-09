"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  uuidSchema,
  inviteCodeSchema,
  moneySchema,
  betSideSchema,
  lineText,
  blockText,
  firstIssue,
} from "@/lib/validation/common";

const createBetWithOptionsSchema = z.object({
  title: lineText(3, 200),
  description: blockText(500).optional(),
  optionLabels: z
    .array(lineText(1, 50))
    .min(2)
    .max(10)
    .refine((labels) => new Set(labels.map((l) => l.toLowerCase())).size === labels.length, {
      message: "Option labels must be unique",
    }),
  // 'USD' (or absent) means money. Anything else is a free-text singular
  // label like "slice of pizza" that follows the bet through payouts into
  // the ledger (migration 022). The plural is optional and derived when
  // omitted.
  stakeUnit: lineText(1, 40).default("USD"),
  stakeUnitPlural: lineText(1, 60).optional(),
  minWager: z.coerce.number().positive().max(100000).optional(),
  maxWager: z.coerce.number().positive().max(100000).optional(),
  deadline: z.string().optional(),
});

const createBetSchema = z
  .object({
    title: lineText(3, 200),
    description: blockText(500).optional(),
    sideALabel: lineText(1, 50).default("Yes"),
    sideBLabel: lineText(1, 50).default("No"),
    // 'USD' (or absent) means money. Anything else is a free-text singular
    // label like "slice of pizza" that follows the bet through payouts into
    // the ledger (migration 022). The plural is optional and derived when
    // omitted.
    stakeUnit: lineText(1, 40).default("USD"),
    stakeUnitPlural: lineText(1, 60).optional(),
    minWager: z.coerce.number().positive().max(100000).optional(),
    maxWager: z.coerce.number().positive().max(100000).optional(),
    deadline: z.string().optional(),
    creatorSide: z.enum(["a", "b"]).optional(),
    creatorAmount: z.coerce.number().positive().max(100000).optional(),
  })
  .refine((d) => (d.minWager == null || d.maxWager == null) || d.minWager <= d.maxWager, {
    message: "Minimum wager can't exceed maximum wager",
    path: ["maxWager"],
  })
  .refine((d) => Boolean(d.creatorSide) === Boolean(d.creatorAmount), {
    message: "Choose a side and an amount to wager now, or leave both blank",
    path: ["creatorAmount"],
  });

export async function createBet(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = createBetSchema.safeParse({
    title: formData.get("title"),
    // `|| undefined` is load-bearing: FormData.get returns null for a key the
    // form never set, and `.optional()` accepts undefined but rejects null --
    // so a bet with no description failed to parse as "Invalid form data".
    description: formData.get("description") || undefined,
    sideALabel: formData.get("sideALabel"),
    sideBLabel: formData.get("sideBLabel"),
    stakeUnit: formData.get("stakeUnit") || undefined,
    stakeUnitPlural: formData.get("stakeUnitPlural") || undefined,
    minWager: formData.get("minWager") || undefined,
    maxWager: formData.get("maxWager") || undefined,
    deadline: formData.get("deadline") || undefined,
    creatorSide: formData.get("creatorSide") || undefined,
    creatorAmount: formData.get("creatorAmount") || undefined,
  });

  if (!parsed.success) {
    return { error: "Invalid form data", details: parsed.error.flatten() };
  }

  const {
    title, description, sideALabel, sideBLabel, stakeUnit, stakeUnitPlural,
    minWager, maxWager, deadline, creatorSide, creatorAmount,
  } = parsed.data;

  const { data: bet, error } = await supabase
    .from("bets")
    .insert({
      title,
      description: description ?? null,
      side_a_label: sideALabel,
      side_b_label: sideBLabel,
      min_wager: minWager ?? null,
      max_wager: maxWager ?? null,
      stake_unit: stakeUnit || "USD",
      stake_unit_plural: stakeUnitPlural ?? null,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      creator_id: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  if (creatorSide && creatorAmount) {
    const serviceClient = await createServiceClient();
    await serviceClient.rpc("place_wager", {
      p_bet_id: bet.id,
      p_user_id: user.id,
      p_side: creatorSide,
      p_amount: creatorAmount,
    });
    // Non-fatal if this fails (e.g. amount outside min/max) -- the bet
    // still exists and the creator can wager again from its own page.
  }

  revalidatePath("/dashboard");
  redirect(`/bets/${bet.id}`);
}

/**
 * Multi-option counterpart of createBet, used when the wizard has 3+ option
 * inputs filled in. Unlike createBet, there's no "wager on this myself now"
 * shortcut here -- the creator wagers as a normal follow-up action on the
 * bet's own page, same as any other participant.
 */
export async function createBetWithOptions(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = createBetWithOptionsSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    optionLabels: formData.getAll("optionLabels"),
    stakeUnit: formData.get("stakeUnit") || undefined,
    stakeUnitPlural: formData.get("stakeUnitPlural") || undefined,
    minWager: formData.get("minWager") || undefined,
    maxWager: formData.get("maxWager") || undefined,
    deadline: formData.get("deadline") || undefined,
  });

  if (!parsed.success) {
    return { error: "Invalid form data", details: parsed.error.flatten() };
  }

  const {
    title, description, optionLabels, minWager, maxWager, deadline,
    stakeUnit, stakeUnitPlural,
  } = parsed.data;

  const serviceClient = await createServiceClient();
  const { data: betId, error } = await serviceClient.rpc("create_bet_with_options", {
    p_creator_id: user.id,
    p_title: title,
    p_description: description ?? null,
    p_option_labels: optionLabels,
    p_min_wager: minWager ?? null,
    p_max_wager: maxWager ?? null,
    p_deadline: deadline ? new Date(deadline).toISOString() : null,
    p_stake_unit: stakeUnit || "USD",
    p_stake_unit_plural: stakeUnitPlural ?? null,
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  redirect(`/bets/${betId}`);
}

export async function placeWager(
  identifier: { betId: string } | { inviteCode: string },
  side: "a" | "b",
  amount: number
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const redirectTarget = "inviteCode" in identifier ? `/bet/${identifier.inviteCode}` : `/bets/${identifier.betId}`;
  if (!user) redirect(`/login?redirect=${encodeURIComponent(redirectTarget)}`);

  const parsedSide = betSideSchema.safeParse(side);
  const parsedAmount = moneySchema.safeParse(amount);
  const parsedIdentifier = "betId" in identifier
    ? uuidSchema.safeParse(identifier.betId)
    : inviteCodeSchema.safeParse(identifier.inviteCode);
  if (!parsedSide.success) return { error: "Invalid side" };
  if (!parsedAmount.success) return { error: firstIssue(parsedAmount.error) };
  if (!parsedIdentifier.success) return { error: "Bet not found" };

  const serviceClient = await createServiceClient();
  const { data: bet } = await serviceClient
    .from("bets")
    .select("id")
    .match("betId" in identifier ? { id: parsedIdentifier.data } : { invite_code: parsedIdentifier.data })
    .single();

  if (!bet) return { error: "Bet not found" };

  const { error } = await serviceClient.rpc("place_wager", {
    p_bet_id: bet.id,
    p_user_id: user.id,
    p_side: parsedSide.data,
    p_amount: parsedAmount.data,
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  revalidatePath(`/bets/${bet.id}`);
  redirect(`/bets/${bet.id}`);
}

/** option_id-based counterpart of placeWager, for a bet with 3+ options. */
export async function placeOptionWager(
  identifier: { betId: string } | { inviteCode: string },
  optionId: string,
  amount: number
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const redirectTarget = "inviteCode" in identifier ? `/bet/${identifier.inviteCode}` : `/bets/${identifier.betId}`;
  if (!user) redirect(`/login?redirect=${encodeURIComponent(redirectTarget)}`);

  const parsedOptionId = uuidSchema.safeParse(optionId);
  const parsedAmount = moneySchema.safeParse(amount);
  const parsedIdentifier = "betId" in identifier
    ? uuidSchema.safeParse(identifier.betId)
    : inviteCodeSchema.safeParse(identifier.inviteCode);
  if (!parsedOptionId.success) return { error: "Invalid option" };
  if (!parsedAmount.success) return { error: firstIssue(parsedAmount.error) };
  if (!parsedIdentifier.success) return { error: "Bet not found" };

  const serviceClient = await createServiceClient();
  const { data: bet } = await serviceClient
    .from("bets")
    .select("id")
    .match("betId" in identifier ? { id: parsedIdentifier.data } : { invite_code: parsedIdentifier.data })
    .single();

  if (!bet) return { error: "Bet not found" };

  const { error } = await serviceClient.rpc("place_option_wager", {
    p_bet_id: bet.id,
    p_user_id: user.id,
    p_option_id: parsedOptionId.data,
    p_amount: parsedAmount.data,
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

  const parsedId = uuidSchema.safeParse(betId);
  if (!parsedId.success) return { error: "Bet not found" };

  const { data, error } = await supabase
    .from("bets")
    .update({ status: "locked" })
    .eq("id", parsedId.data)
    .eq("creator_id", user.id)
    .eq("status", "active")
    .select("id")
    .single();

  if (error || !data) {
    return { error: "Unable to lock this bet -- it must be funded on both sides and you must be the creator" };
  }

  revalidatePath(`/bets/${betId}`);
  return { success: true };
}

export async function cancelBet(betId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsedId = uuidSchema.safeParse(betId);
  if (!parsedId.success) return { error: "Bet not found" };

  const { error } = await supabase
    .from("bets")
    .update({ status: "cancelled" })
    .eq("id", parsedId.data)
    .eq("creator_id", user.id)
    .in("status", ["open", "active"]);

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  revalidatePath(`/bets/${betId}`);
  return { success: true };
}

/**
 * Deletes a bet outright rather than cancelling it -- only legal for a bet
 * that never really became an agreement between people. The RPC (migration
 * 018) is the actual authority: creator-only, not resolved/resolving, no
 * bet_participants row besides the creator's own, and no ledger/settlement/
 * usdc row naming it. This action does no eligibility checking of its own --
 * the same way cancelBet above leaves its own WHERE clause as the only gate
 * -- it just forwards the call and turns the RPC's error text into what the
 * UI shows, same as every other RPC-backed action in this file.
 */
export async function deleteBet(betId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsedId = uuidSchema.safeParse(betId);
  if (!parsedId.success) return { error: "Bet not found" };

  const { error } = await supabase.rpc("delete_bet", { p_bet_id: parsedId.data });

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return { success: true };
}
