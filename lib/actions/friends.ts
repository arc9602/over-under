"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { firstIssue, uuidSchema } from "@/lib/validation/common";

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Enter a valid username")
  .max(20, "Enter a valid username")
  .regex(/^[a-z0-9_]+$/, "Enter a valid username");

// Same character rule as usernameSchema, but a 2-char floor instead of 3 --
// this validates a prefix someone is still typing, not a complete username,
// and search_profiles_by_username (021) enforces the same floor server-side.
// No error message wired to this one: see searchUsernames below for why a
// too-short prefix returns quietly instead of failing.
const usernamePrefixSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(20)
  .regex(/^[a-z0-9_]+$/);

const emailLookupSchema = z.string().trim().toLowerCase().email();

// ---------------------------------------------------------------------------
// "No account with that email", "that account opted out of email discovery",
// and "that's your own email" must all read as the exact same string on the
// client, and nothing else. Migration 021's find_profile_by_email already
// collapses all three into zero rows (the opt-out and the self-exclusion are
// WHERE clauses, not separate branches) -- findFriendByEmail's job below is
// to not undo that by being helpful on the way back out, which is why it
// returns a bare `{ result: null }` rather than a case-specific message: a
// 'use server' file may only export async functions, so the single
// not-found string this collapses to lives as a constant in
// FriendsPageClient.tsx instead, not here. Do not add a branch that
// distinguishes "no such account" from "found but hidden" -- the difference
// between those two sentences is precisely what the opt-out exists to hide.
// ---------------------------------------------------------------------------

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

export type UsernameSearchResult = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

/**
 * Typeahead backing search_profiles_by_username (021). Called via the
 * service client because the RPC is revoked from `authenticated` -- see the
 * migration's section 5 for why (it takes p_user_id as an argument, so an
 * un-gated grant would let a caller spend someone else's rate-limit budget).
 *
 * A too-short prefix is not an error, it is "nothing to search yet": a
 * typeahead that flashes red on the first keystroke reads as broken. Only a
 * real RPC failure (including the rate limit) returns `{ error }`.
 */
export async function searchUsernames(
  prefix: string
): Promise<{ results: UsernameSearchResult[] } | { error: string }> {
  const parsed = usernamePrefixSchema.safeParse(prefix);
  if (!parsed.success) return { results: [] };

  const { user } = await authenticatedClient();
  const serviceClient = await createServiceClient();

  const { data, error } = await serviceClient.rpc("search_profiles_by_username", {
    p_user_id: user.id,
    p_prefix: parsed.data,
  });

  if (error) {
    console.error("[friends] username search failed", error);
    if (/too many searches/i.test(error.message)) {
      return { error: "Too many searches -- wait a moment and try again" };
    }
    return { error: "Couldn't search right now" };
  }

  return {
    results: (data ?? []).map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    })),
  };
}

export type EmailSearchResult = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

/**
 * Exact-match lookup backing find_profile_by_email (021). Also service-client
 * only, same reason as searchUsernames above.
 *
 * See EMAIL_NOT_FOUND_MESSAGE above this file: every empty result -- no such
 * account, an account that opted out, or the caller's own email -- must
 * produce `{ result: null }` and nothing that lets a caller tell those apart.
 * The RPC already collapses them into zero rows; this function just has to
 * not add a distinction back on top.
 *
 * Never logs the email itself, on any path, including failure -- only that a
 * lookup happened and, if it failed, the (address-free) Postgres error.
 */
export async function findFriendByEmail(
  email: string
): Promise<{ result: EmailSearchResult | null } | { error: string }> {
  const parsed = emailLookupSchema.safeParse(email);
  if (!parsed.success) return { error: "Enter a valid email address" };

  const { user } = await authenticatedClient();
  const serviceClient = await createServiceClient();

  const { data, error } = await serviceClient.rpc("find_profile_by_email", {
    p_user_id: user.id,
    p_email: parsed.data,
  });

  if (error) {
    console.error("[friends] email lookup failed", error.message);
    if (/too many lookups/i.test(error.message)) {
      return { error: "Too many lookups -- wait a moment and try again" };
    }
    return { error: "Couldn't search right now" };
  }

  const row = data?.[0];
  if (!row) return { result: null };

  return {
    result: {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    },
  };
}
