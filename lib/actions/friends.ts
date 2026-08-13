"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { firstIssue, uuidSchema } from "@/lib/validation/common";

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Enter a valid username")
  .max(20, "Enter a valid username")
  .regex(/^[a-z0-9_]+$/, "Enter a valid username");

async function authenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function sendFriendRequest(username: string) {
  const parsed = usernameSchema.safeParse(username);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { supabase, user } = await authenticatedClient();
  const { data: recipient, error: lookupError } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", parsed.data)
    .neq("id", user.id)
    .maybeSingle();

  if (lookupError) return { error: lookupError.message };
  if (!recipient) return { error: "No user found with that username" };

  const { error } = await supabase.rpc("send_friend_request", {
    p_recipient_id: recipient.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/friends");
  return { success: true };
}

export async function respondFriendRequest(
  requestId: string,
  accept: boolean
) {
  const parsed = uuidSchema.safeParse(requestId);
  if (!parsed.success || typeof accept !== "boolean") {
    return { error: "Invalid friend request" };
  }

  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("respond_friend_request", {
    p_request_id: parsed.data,
    p_accept: accept,
  });
  if (error) return { error: error.message };

  revalidatePath("/friends");
  return { success: true };
}

export async function cancelFriendRequest(requestId: string) {
  const parsed = uuidSchema.safeParse(requestId);
  if (!parsed.success) return { error: "Invalid friend request" };

  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("cancel_friend_request", {
    p_request_id: parsed.data,
  });
  if (error) return { error: error.message };

  revalidatePath("/friends");
  return { success: true };
}

export async function removeFriend(friendId: string) {
  const parsed = uuidSchema.safeParse(friendId);
  if (!parsed.success) return { error: "Invalid friend" };

  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("remove_friend", {
    p_friend_id: parsed.data,
  });
  if (error) return { error: error.message };

  revalidatePath("/friends");
  revalidatePath("/bets/[betId]", "page");
  return { success: true };
}
