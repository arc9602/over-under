import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

/**
 * Whole-population product metrics for the pre-launch admin dashboard --
 * total users, retention by week, repeat-bet rate, outstanding IOU volume.
 *
 * Every query below goes through createServiceClient(), which bypasses RLS.
 * That's not incidental: RLS on profiles/bets/bet_participants/iou_ledger
 * scopes every row to auth.uid(), so there is no RLS-respecting way to ask
 * "how many total users are there" at all. The consequence is that this
 * module has no per-user boundary of its own -- it hands back every user's
 * data to whoever calls it. THIS MUST ONLY EVER BE CALLED FROM AN
 * ADMIN-GATED PAGE (see isAdmin() in lib/chain/env.ts). There is no check
 * inside this file; the caller is the entire security boundary. A future
 * edit that imports getProductMetrics() from an unguarded page or a public
 * API route turns this into a full user-data leak.
 */

export type ProductMetrics = {
  totalUsers: number;
  totalBets: number;
  usersWithABet: number;
  usersWithTwoPlusBets: number;
  weekly: { weekStart: string; signups: number; activeBettors: number }[];
  unsettledIouCents: number;
  settledIouCents: number;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEKS_OF_HISTORY = 12;

// Monday 00:00 UTC of the week containing `d`. Weeks are bucketed in UTC, not
// the reader's local time, so a signup at 11pm Pacific on a Sunday and one at
// 2am UTC Monday land in different weeks here even though they might feel
// like "the same night" to a Pacific-time reader. Picking one fixed
// convention beats one that quietly shifts depending on who's looking.
function startOfUtcWeek(d: Date): Date {
  const midnight = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = midnight.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  midnight.setUTCDate(midnight.getUTCDate() - daysSinceMonday);
  return midnight;
}

export async function getProductMetrics(): Promise<ProductMetrics> {
  const db = await createServiceClient();

  const currentWeekStart = startOfUtcWeek(new Date());
  // Oldest first, 12 buckets including the current (possibly partial) week.
  const weekStarts: Date[] = [];
  for (let i = WEEKS_OF_HISTORY - 1; i >= 0; i--) {
    weekStarts.push(new Date(currentWeekStart.getTime() - i * WEEK_MS));
  }
  const oldestWeekStart = weekStarts[0];

  const [
    { count: totalUsers, error: totalUsersError },
    { count: totalBets, error: totalBetsError },
    { data: recentProfiles, error: profilesError },
    { data: allParticipants, error: allParticipantsError },
    { data: recentParticipants, error: recentParticipantsError },
    { data: ious, error: iousError },
  ] = await Promise.all([
    db.from("profiles").select("*", { count: "exact", head: true }),
    db.from("bets").select("*", { count: "exact", head: true }),
    // Only the last 12 weeks' worth are needed for the weekly signup series.
    db
      .from("profiles")
      .select("created_at")
      .gte("created_at", oldestWeekStart.toISOString()),
    // usersWithABet / usersWithTwoPlusBets are lifetime signals, not windowed
    // ones, so this one stays unbounded -- user_id only, though, since
    // joined_at is never read off it and there's no reason to ship a column
    // this query doesn't use.
    db.from("bet_participants").select("user_id"),
    // activeBettors, unlike the counts above, is windowed to the same 12
    // weeks `weekly` displays -- a second, bounded query rather than
    // filtering the one above, since that one has to stay lifetime. Reuses
    // oldestWeekStart rather than recomputing it so the fetch boundary and
    // the bucketing boundary can't drift apart.
    db
      .from("bet_participants")
      .select("user_id, joined_at")
      .gte("joined_at", oldestWeekStart.toISOString()),
    // Unlike bet_participants above, these totals are genuinely all-time --
    // "outstanding IOU volume" on the admin dashboard means every unsettled
    // cent in the system, not just the last 12 weeks of it, so there's no
    // cutoff to apply without changing what the number means. Pre-launch row
    // counts keep this cheap; revisit if that stops being true.
    db.from("iou_ledger").select("amount, settled"),
  ]);

  if (totalUsersError) throw totalUsersError;
  if (totalBetsError) throw totalBetsError;
  if (profilesError) throw profilesError;
  if (allParticipantsError) throw allParticipantsError;
  if (recentParticipantsError) throw recentParticipantsError;
  if (iousError) throw iousError;

  // weekStart epoch ms -> index in `weekly`, so each row bucket-matches in
  // O(1) instead of a linear scan per row.
  const weekIndex = new Map<number, number>();
  weekStarts.forEach((ws, i) => weekIndex.set(ws.getTime(), i));

  // Zero-filled up front: a week with no activity must appear as a 0 row,
  // not be missing, or a chart built on this silently lies about a flat
  // period by just not drawing a point for it.
  const weekly = weekStarts.map((ws) => ({
    weekStart: ws.toISOString().slice(0, 10),
    signups: 0,
    activeBettors: 0,
  }));

  for (const profile of recentProfiles ?? []) {
    const idx = weekIndex.get(startOfUtcWeek(new Date(profile.created_at)).getTime());
    if (idx !== undefined) weekly[idx].signups++;
  }

  // A Set per week so the same user joining two bets in one week still
  // counts once -- activeBettors is "distinct users who did the core
  // action," not "how many bets were joined."
  const activeBettorSets: Set<string>[] = weekStarts.map(() => new Set());
  for (const row of recentParticipants ?? []) {
    const idx = weekIndex.get(startOfUtcWeek(new Date(row.joined_at)).getTime());
    if (idx !== undefined) activeBettorSets[idx].add(row.user_id);
  }
  weekly.forEach((w, i) => (w.activeBettors = activeBettorSets[i].size));

  const betCountByUser = new Map<string, number>();
  for (const row of allParticipants ?? []) {
    betCountByUser.set(row.user_id, (betCountByUser.get(row.user_id) ?? 0) + 1);
  }

  let usersWithABet = 0;
  let usersWithTwoPlusBets = 0;
  for (const count of betCountByUser.values()) {
    usersWithABet++;
    if (count >= 2) usersWithTwoPlusBets++;
  }

  // Cents, via Math.round(amount * 100) -- same convention as
  // lib/actions/balances.ts's settlement-amount comparison. Never floats.
  let unsettledIouCents = 0;
  let settledIouCents = 0;
  for (const iou of ious ?? []) {
    const cents = Math.round(iou.amount * 100);
    if (iou.settled) settledIouCents += cents;
    else unsettledIouCents += cents;
  }

  return {
    totalUsers: totalUsers ?? 0,
    totalBets: totalBets ?? 0,
    usersWithABet,
    usersWithTwoPlusBets,
    weekly,
    unsettledIouCents,
    settledIouCents,
  };
}
