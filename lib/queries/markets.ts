import { createClient } from "@/lib/supabase/server";
import type { MarketWithBook, MarketWithDetails } from "@/lib/types";

// market_fills has two foreign keys to profiles, so both embeds have to name
// the constraint they travel; PostgREST can't guess which one you meant.
const BOOK_SELECT = `
  *,
  creator:profiles!markets_creator_id_fkey (*),
  market_orders (
    *,
    profiles!market_orders_user_id_fkey (*)
  ),
  market_fills (
    *,
    yes_profile:profiles!market_fills_yes_user_id_fkey (*),
    no_profile:profiles!market_fills_no_user_id_fkey (*)
  )
`;

export async function getMarketsForUser(userId: string): Promise<MarketWithBook[]> {
  const supabase = await createClient();

  // Same shape as getBetsForUser: PostgREST can't filter on an embedded
  // column inside .or() against the top-level table, so resolve the ids the
  // user is involved with first. A creator may have placed no orders at all,
  // so creation and participation are two separate lookups.
  const [orderRows, createdRows] = await Promise.all([
    supabase.from("market_orders").select("market_id").eq("user_id", userId),
    supabase.from("markets").select("id").eq("creator_id", userId),
  ]);

  if (orderRows.error) throw orderRows.error;
  if (createdRows.error) throw createdRows.error;

  const marketIds = Array.from(
    new Set([
      ...orderRows.data.map((o) => o.market_id),
      ...createdRows.data.map((m) => m.id),
    ])
  );
  if (marketIds.length === 0) return [];

  const { data, error } = await supabase
    .from("markets")
    .select(BOOK_SELECT)
    .in("id", marketIds)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const markets = (data ?? []) as unknown as MarketWithBook[];

  // Check-on-read expiry, matching getBetsForUser.
  const now = new Date();
  return markets.map((market) => {
    if (
      market.status === "open" &&
      market.deadline &&
      new Date(market.deadline) < now
    ) {
      return { ...market, status: "expired" as const };
    }
    return market;
  });
}

export async function getMarketById(marketId: string): Promise<MarketWithDetails | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("markets")
    .select(`${BOOK_SELECT}, market_resolutions (*)`)
    .eq("id", marketId)
    .single();

  if (error) return null;
  return data as unknown as MarketWithDetails;
}

export async function getMarketByInviteCode(inviteCode: string) {
  // Service role, same as getBetByInviteCode: someone arriving on an invite
  // link has no orders yet, so RLS would hide the market and its book from
  // them entirely.
  const { createServiceClient } = await import("@/lib/supabase/server");
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("markets")
    .select(BOOK_SELECT)
    .eq("invite_code", inviteCode)
    .single();

  if (error) return null;
  return data as unknown as MarketWithBook;
}
