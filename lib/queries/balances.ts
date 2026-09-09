import { createClient } from "@/lib/supabase/server";
import { MONEY_UNIT } from "@/lib/utils/formatStake";
import type { IouEntry, NetBalance, Profile, UnitBalance } from "@/lib/types";

export async function getIouLedger(userId: string): Promise<IouEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("iou_ledger")
    .select("*")
    .or(`creditor_id.eq.${userId},debtor_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getNetIouForBet(betId: string, userId: string): Promise<number> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("iou_ledger")
    .select("creditor_id, debtor_id, amount")
    .eq("bet_id", betId)
    .or(`creditor_id.eq.${userId},debtor_id.eq.${userId}`);

  if (error) throw error;

  return (data ?? []).reduce(
    (net, iou) => net + (iou.creditor_id === userId ? iou.amount : -iou.amount),
    0
  );
}

export async function getNetIouForMarket(marketId: string, userId: string): Promise<number> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("iou_ledger")
    .select("creditor_id, debtor_id, amount")
    .eq("market_id", marketId)
    .or(`creditor_id.eq.${userId},debtor_id.eq.${userId}`);

  if (error) throw error;

  return (data ?? []).reduce(
    (net, iou) => net + (iou.creditor_id === userId ? iou.amount : -iou.amount),
    0
  );
}

/**
 * Net balances per friend, split by unit (migration 022).
 *
 * Debts in different units are separate obligations: $20 and 3 slices of pizza
 * cannot be added, so each friend carries a list of per-unit balances rather
 * than one number. Money sorts first; a unit that nets to zero is dropped.
 */
export async function getNetBalancesForUser(userId: string): Promise<NetBalance[]> {
  const supabase = await createClient();

  const { data: ious, error } = await supabase
    .from("iou_ledger")
    .select("*")
    .or(`creditor_id.eq.${userId},debtor_id.eq.${userId}`)
    .eq("settled", false);

  if (error) throw error;

  const friendIds = new Set<string>();
  for (const iou of ious ?? []) {
    friendIds.add(iou.creditor_id === userId ? iou.debtor_id : iou.creditor_id);
  }

  if (friendIds.size === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .in("id", Array.from(friendIds));

  const profileMap = new Map<string, Profile>(
    (profiles ?? []).map((p) => [p.id, p])
  );

  // friendId -> unit -> running balance
  const byFriend = new Map<string, Map<string, UnitBalance>>();

  for (const iou of ious ?? []) {
    const friendId = iou.creditor_id === userId ? iou.debtor_id : iou.creditor_id;
    const unit = iou.unit || MONEY_UNIT;

    let units = byFriend.get(friendId);
    if (!units) {
      units = new Map<string, UnitBalance>();
      byFriend.set(friendId, units);
    }

    let entry = units.get(unit);
    if (!entry) {
      entry = { unit, unitPlural: iou.unit_plural, netAmount: 0, unsettledIous: [] };
      units.set(unit, entry);
    }

    // Rows written before an explicit plural existed still carry the unit, so
    // take the first plural that turns up rather than losing the override.
    if (!entry.unitPlural && iou.unit_plural) entry.unitPlural = iou.unit_plural;

    entry.netAmount += iou.creditor_id === userId ? iou.amount : -iou.amount;
    entry.unsettledIous.push(iou);
  }

  const results: NetBalance[] = [];
  for (const [friendId, units] of byFriend.entries()) {
    const friend = profileMap.get(friendId);
    if (!friend) continue;

    const list = Array.from(units.values())
      // Opposing IOUs can cancel a unit out entirely. Half a cent of rounding
      // drift shouldn't then show up as a live debt.
      .filter((u) => Math.abs(u.netAmount) >= 0.005)
      .sort((a, b) => {
        if (a.unit === MONEY_UNIT) return -1;
        if (b.unit === MONEY_UNIT) return 1;
        return Math.abs(b.netAmount) - Math.abs(a.netAmount);
      });

    if (list.length > 0) results.push({ friend, units: list });
  }

  const magnitude = (b: NetBalance) =>
    b.units.reduce((sum, u) => sum + Math.abs(u.netAmount), 0);

  return results.sort((a, b) => magnitude(b) - magnitude(a));
}
