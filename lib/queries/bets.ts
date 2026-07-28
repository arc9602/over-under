import { createClient } from "@/lib/supabase/server";
import type { BetWithDetails, BetWithParticipants } from "@/lib/types";

export async function getBetsForUser(userId: string): Promise<BetWithParticipants[]> {
  const supabase = await createClient();

  // PostgREST can't parse a filter on an embedded (bet_participants) column
  // inside .or() against the top-level bets table, so look up the bet ids
  // the user participates in (creator included -- the creation RPC always
  // adds them as a participant too) first, then fetch the full rows.
  const { data: participantRows, error: participantErr } = await supabase
    .from("bet_participants")
    .select("bet_id")
    .eq("user_id", userId);

  if (participantErr) throw participantErr;

  const betIds = participantRows.map((p) => p.bet_id);
  if (betIds.length === 0) return [];

  const { data, error } = await supabase
    .from("bets")
    .select(`
      *,
      bet_participants (
        *,
        profiles (*)
      )
    `)
    .in("id", betIds)
    .order("created_at", { ascending: false });

  if (error) throw error;

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
