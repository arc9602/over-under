import { createClient } from "@/lib/supabase/server";
import type {
  FriendRequest,
  FriendRequestWithProfile,
  Profile,
} from "@/lib/types";

export async function getFriendsForUser(userId: string): Promise<Profile[]> {
  const supabase = await createClient();
  const { data: friendships, error } = await supabase
    .from("friendships")
    .select("user_low_id, user_high_id, created_at")
    .or(`user_low_id.eq.${userId},user_high_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const friendIds = (friendships ?? []).map((friendship) =>
    friendship.user_low_id === userId
      ? friendship.user_high_id
      : friendship.user_low_id
  );
  if (friendIds.length === 0) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("*")
    .in("id", friendIds);

  if (profilesError) throw profilesError;

  const byId = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile as Profile])
  );
  return friendIds
    .map((friendId) => byId.get(friendId))
    .filter((profile): profile is Profile => Boolean(profile));
}

export async function getFriendRequestsForUser(userId: string): Promise<{
  incoming: FriendRequestWithProfile[];
  outgoing: FriendRequestWithProfile[];
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("friend_requests")
    .select("*")
    .eq("status", "pending")
    .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const requests = (data ?? []) as FriendRequest[];
  const profileIds = Array.from(
    new Set(
      requests.map((request) =>
        request.requester_id === userId
          ? request.recipient_id
          : request.requester_id
      )
    )
  );

  if (profileIds.length === 0) {
    return { incoming: [], outgoing: [] };
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("*")
    .in("id", profileIds);

  if (profilesError) throw profilesError;

  const byId = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile as Profile])
  );
  const withProfiles = requests
    .map((request) => {
      const profileId =
        request.requester_id === userId
          ? request.recipient_id
          : request.requester_id;
      const profile = byId.get(profileId);
      return profile ? { ...request, profile } : null;
    })
    .filter(
      (request): request is FriendRequestWithProfile => request !== null
    );

  return {
    incoming: withProfiles.filter(
      (request) => request.recipient_id === userId
    ),
    outgoing: withProfiles.filter(
      (request) => request.requester_id === userId
    ),
  };
}
