"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/common";

const inviteActionSchema = z.enum(["seen", "declined"]);

async function authenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return supabase;
}

export async function inviteFriendToBet(betId: string, friendId: string) {
  const parsed = z
    .object({ betId: uuidSchema, friendId: uuidSchema })
    .safeParse({ betId, friendId });
  if (!parsed.success) return { error: "Invalid bet invitation" };

  const supabase = await authenticatedClient();
  const { error } = await supabase.rpc("invite_friend_to_bet", {
    p_bet_id: parsed.data.betId,
    p_invitee_id: parsed.data.friendId,
  });
  if (error) return { error: error.message };

  revalidatePath(`/bets/${parsed.data.betId}`);
  revalidatePath("/dashboard");
  return { success: true };
}

export async function updateBetInvite(
  inviteId: string,
  action: "seen" | "declined"
) {
  const parsed = z
    .object({ inviteId: uuidSchema, action: inviteActionSchema })
    .safeParse({ inviteId, action });
  if (!parsed.success) return { error: "Invalid bet invitation" };

  const supabase = await authenticatedClient();
  const { error } = await supabase.rpc("update_bet_invite", {
    p_invite_id: parsed.data.inviteId,
    p_action: parsed.data.action,
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return { success: true };
}
