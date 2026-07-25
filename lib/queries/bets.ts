import { createClient } from "@/lib/supabase/server";
import type { BetWithDetails, BetWithParticipants } from "@/lib/types";

export async function getBetsForUser(userId: string): Promise<BetWithParticipants[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("bets")
    .select(`
      *,
      bet_participants (
        *,
        profiles (*)
      )
    `)
    .or(
      `creator_id.eq.${userId},bet_participants.user_id.eq.${userId}`
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  // Filter to only bets where user is actually a participant (RLS handles this too)
  const bets = (data ?? []) as BetWithParticipants[];

  // Check-on-read expiry
  const now = new Date();
  return bets.map((bet) => {
    if (
      bet.status === "open" &&
      bet.deadline &&
      new Date(bet.deadline) < now
    ) {
      return { ...bet, status: "expired" as const };
    }
    return bet;
  });
}

export async function getBetById(betId: string): Promise<BetWithDetails | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("bets")
    .select(`
      *,
      bet_participants (
        *,
        profiles (*)
      ),
      resolutions (*)
    `)
    .eq("id", betId)
    .single();

  if (error) return null;
  return data as BetWithDetails;
}

export async function getBetByInviteCode(inviteCode: string) {
  // Uses service role to bypass RLS for the public invite landing
  const { createServiceClient } = await import("@/lib/supabase/server");
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("bets")
    .select(`
      *,
      bet_participants (
        *,
        profiles (*)
      )
    `)
    .eq("invite_code", inviteCode)
    .single();

  if (error) return null;
  return data as BetWithParticipants;
}
