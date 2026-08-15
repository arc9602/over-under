import { createClient } from "@/lib/supabase/server";
import type { BetWithDetails, BetWithParticipants } from "@/lib/types";

export async function getBetsForUser(userId: string): Promise<BetWithDetails[]> {
  const supabase = await createClient();

  // PostgREST can't parse a filter on an embedded (bet_participants) column
  // inside .or() against the top-level bets table, so look up the bet ids
  // the user is involved with first, then fetch the full rows. A creator
  // no longer automatically wagers on their own bet, so both creator_id
  // and bet_participants membership need to be checked separately.
  const [participantRows, createdRows] = await Promise.all([
    supabase.from("bet_participants").select("bet_id").eq("user_id", userId),
    supabase.from("bets").select("id").eq("creator_id", userId),
  ]);

  if (participantRows.error) throw participantRows.error;
  if (createdRows.error) throw createdRows.error;

  const betIds = Array.from(
    new Set([
      ...participantRows.data.map((p) => p.bet_id),
      ...createdRows.data.map((b) => b.id),
    ])
  );
  if (betIds.length === 0) return [];

  const { data, error } = await supabase
    .from("bets")
    .select(`
      *,
      creator:profiles!bets_creator_id_fkey (*),
      bet_participants (
        *,
        profiles (*)
      ),
      bet_options (*),
      resolutions (*)
    `)
    .in("id", betIds)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const bets = (data ?? []) as BetWithDetails[];

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
      creator:profiles!bets_creator_id_fkey (*),
      bet_participants (
        *,
        profiles (*)
      ),
      bet_options (*),
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
      creator:profiles!bets_creator_id_fkey (*),
      bet_participants (
        *,
        profiles (*)
      ),
      bet_options (*)
    `)
    .eq("invite_code", inviteCode)
    .single();

  if (error) return null;
  return data as BetWithParticipants;
}
