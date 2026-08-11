"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { multiOptionBetsEnabled } from "@/lib/features";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function proposeResolution(
  betId: string,
  winnerOptionId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (multiOptionBetsEnabled()) {
    const { error } = await supabase.rpc("propose_option_resolution", {
      p_bet_id: betId,
      p_option_id: winnerOptionId,
    });

    if (error) return { error: error.message };
  } else {
    const winnerSide = winnerOptionId === "a" ? "a" : "b";
    const optionCountResult = await supabase
      .from("bet_options")
      .select("id", { count: "exact", head: true })
      .eq("bet_id", betId);

    if (
      optionCountResult.error &&
      !["PGRST205", "42P01"].includes(optionCountResult.error.code)
    ) {
      return { error: optionCountResult.error.message };
    }
    if ((optionCountResult.count ?? 0) > 2) {
      return {
        error:
          "Multi-option resolutions are temporarily disabled; no changes were made",
      };
    }

    const { error: compatibilityError } = await supabase.rpc(
      "propose_legacy_resolution",
      {
        p_bet_id: betId,
        p_side: winnerSide,
      }
    );

    if (!compatibilityError) {
      revalidatePath(`/bets/${betId}`);
      return { success: true };
    }
    if (compatibilityError.code !== "PGRST202") {
      return { error: compatibilityError.message };
    }

    // Before migration 008 exists, retain the deployed binary behavior.
    const { data: bet } = await supabase
      .from("bets")
      .select("id, status")
      .eq("id", betId)
      .single();

    if (!bet || bet.status !== "locked") {
      return {
        error: "Bet must be locked before proposing a resolution",
      };
    }

    const { error } = await supabase.from("resolutions").insert({
      bet_id: betId,
      proposed_by: user.id,
      proposed_winner_side: winnerSide,
    });

    if (error) return { error: error.message };

    const serviceClient = await createServiceClient();
    const { error: updateError } = await serviceClient
      .from("bets")
      .update({ status: "resolving" })
      .eq("id", betId);

    if (updateError) return { error: updateError.message };
  }

  revalidatePath(`/bets/${betId}`);
  return { success: true };
}

export async function confirmResolution(
  resolutionId: string,
  betId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let error;
  if (multiOptionBetsEnabled()) {
    ({ error } = await supabase.rpc("confirm_option_resolution", {
      p_resolution_id: resolutionId,
    }));
  } else {
    const optionResult = await supabase.rpc("confirm_option_resolution", {
      p_resolution_id: resolutionId,
    });
    if (!optionResult.error) {
      error = null;
    } else if (optionResult.error.code !== "PGRST202") {
      error = optionResult.error;
    } else {
      // Before migration 008 exists, retain the deployed binary behavior.
      const { data: resolution } = await supabase
        .from("resolutions")
        .select("bet_id, proposed_by, status")
        .eq("id", resolutionId)
        .eq("bet_id", betId)
        .single();

      if (!resolution || resolution.status !== "pending") {
        return { error: "Resolution not found or already resolved" };
      }
      if (resolution.proposed_by === user.id) {
        return { error: "Another participant must confirm the resolution" };
      }

      const { data: participation } = await supabase
        .from("bet_participants")
        .select("id")
        .eq("bet_id", resolution.bet_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!participation) {
        return { error: "Only participants can confirm the resolution" };
      }

      ({ error } = await (await createServiceClient()).rpc(
        "confirm_resolution",
        {
          p_resolution_id: resolutionId,
          p_confirmer_id: user.id,
        }
      ));
    }
  }

  if (error) return { error: error.message };

  revalidatePath(`/bets/${betId}`);
  revalidatePath("/dashboard");
  revalidatePath("/balances");
  return { success: true };
}

export async function disputeResolution(
  resolutionId: string,
  betId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let error;
  if (multiOptionBetsEnabled()) {
    ({ error } = await supabase.rpc("dispute_option_resolution", {
      p_resolution_id: resolutionId,
    }));
  } else {
    const optionResult = await supabase.rpc("dispute_option_resolution", {
      p_resolution_id: resolutionId,
    });
    if (!optionResult.error) {
      error = null;
    } else if (optionResult.error.code !== "PGRST202") {
      error = optionResult.error;
    } else {
      // Before migration 008 exists, retain the deployed binary behavior.
      const { data: resolution } = await supabase
        .from("resolutions")
        .select("bet_id, proposed_by, status")
        .eq("id", resolutionId)
        .eq("bet_id", betId)
        .single();

      if (!resolution || resolution.status !== "pending") {
        return { error: "Resolution not found or not pending" };
      }
      if (resolution.proposed_by === user.id) {
        return { error: "Another participant must dispute the resolution" };
      }

      const { data: participation } = await supabase
        .from("bet_participants")
        .select("id")
        .eq("bet_id", resolution.bet_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!participation) {
        return { error: "Only participants can dispute the resolution" };
      }

      ({ error } = await (await createServiceClient()).rpc(
        "dispute_resolution",
        {
          p_resolution_id: resolutionId,
          p_disputer_id: user.id,
        }
      ));
    }
  }

  if (error) return { error: error.message };

  revalidatePath(`/bets/${betId}`);
  return { success: true };
}
