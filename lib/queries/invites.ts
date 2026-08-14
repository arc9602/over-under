import { createClient, createServiceClient } from "@/lib/supabase/server";
import type {
  BetInvite,
  BetInviteWithDetails,
  BetStatus,
  Profile,
} from "@/lib/types";

export async function getBetInvitesForUser(
  userId: string
): Promise<BetInviteWithDetails[]> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("bet_invites")
    .select("*")
    .eq("invitee_id", userId)
    .in("status", ["pending", "seen"])
    .order("created_at", { ascending: false });

  if (error) throw error;

  const invites = (data ?? []) as BetInvite[];
  if (invites.length === 0) return [];

  const inviterIds = Array.from(
    new Set(invites.map((invite) => invite.inviter_id))
  );
  const betIds = Array.from(new Set(invites.map((invite) => invite.bet_id)));

  const [profilesResult, betsResult, participantsResult] = await Promise.all([
    supabase.from("profiles").select("*").in("id", inviterIds),
    supabase
      .from("bets")
      .select("id, title, invite_code, status, deadline")
      .in("id", betIds),
    supabase
      .from("bet_participants")
      .select("bet_id")
      .eq("user_id", userId)
      .in("bet_id", betIds),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (betsResult.error) throw betsResult.error;
  if (participantsResult.error) throw participantsResult.error;

  const profilesById = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.id,
      profile as Profile,
    ])
  );
  const betsById = new Map(
    (betsResult.data ?? []).map((bet) => [
      bet.id,
      {
        ...bet,
        status: bet.status as BetStatus,
      },
    ])
  );
  const joinedBetIds = new Set(
    (participantsResult.data ?? []).map((participant) => participant.bet_id)
  );

  return invites
    .map((invite) => {
      const inviter = profilesById.get(invite.inviter_id);
      const bet = betsById.get(invite.bet_id);
      if (
        joinedBetIds.has(invite.bet_id) ||
        !inviter ||
        !bet ||
        (bet.deadline !== null &&
          new Date(bet.deadline).getTime() <= Date.now()) ||
        (bet.status !== "open" && bet.status !== "active")
      ) {
        return null;
      }
      return { ...invite, inviter, bet };
    })
    .filter((invite): invite is BetInviteWithDetails => invite !== null);
}

export async function getSentBetInviteeIds(
  betId: string,
  inviterId: string
): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bet_invites")
    .select("invitee_id")
    .eq("bet_id", betId)
    .eq("inviter_id", inviterId)
    .in("status", ["pending", "seen"]);

  if (error) throw error;
  return (data ?? []).map((invite) => invite.invitee_id);
}
