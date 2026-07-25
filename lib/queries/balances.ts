import { createClient } from "@/lib/supabase/server";
import type { IouEntry, NetBalance, Profile } from "@/lib/types";

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

export async function getNetBalancesForUser(userId: string): Promise<NetBalance[]> {
  const supabase = await createClient();

  const { data: ious, error } = await supabase
    .from("iou_ledger")
    .select("*")
    .or(`creditor_id.eq.${userId},debtor_id.eq.${userId}`)
    .eq("settled", false);

  if (error) throw error;

  // Collect all friend IDs
  const friendIds = new Set<string>();
  for (const iou of ious ?? []) {
    const friendId = iou.creditor_id === userId ? iou.debtor_id : iou.creditor_id;
    friendIds.add(friendId);
  }

  if (friendIds.size === 0) return [];

  // Fetch friend profiles
  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .in("id", Array.from(friendIds));

  const profileMap = new Map<string, Profile>(
    (profiles ?? []).map((p) => [p.id, p])
  );

  // Compute net balance per friend
  const balanceMap = new Map<string, { net: number; ious: IouEntry[] }>();

  for (const iou of ious ?? []) {
    const friendId = iou.creditor_id === userId ? iou.debtor_id : iou.creditor_id;
    const entry = balanceMap.get(friendId) ?? { net: 0, ious: [] };

    if (iou.creditor_id === userId) {
      // They owe me
      entry.net += iou.amount;
    } else {
      // I owe them
      entry.net -= iou.amount;
    }
    entry.ious.push(iou);
    balanceMap.set(friendId, entry);
  }

  const results: NetBalance[] = [];
  for (const [friendId, entry] of balanceMap.entries()) {
    const friend = profileMap.get(friendId);
    if (friend) {
      results.push({
        friend,
        netAmount: entry.net,
        unsettledIous: entry.ious,
      });
    }
  }

  return results.sort((a, b) => Math.abs(b.netAmount) - Math.abs(a.netAmount));
}
