import { redirect } from "next/navigation";
import Link from "next/link";
import { getMarketByInviteCode } from "@/lib/queries/markets";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { BetStatusBadge } from "@/components/bet/BetStatusBadge";
import { CountdownTimer } from "@/components/bet/CountdownTimer";
import { MarketInviteWager } from "@/components/market/MarketInviteWager";
import type { SideChoiceOption } from "@/components/bet/SideChoice";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatCents } from "@/lib/utils/marketBook";
import type { MarketSide } from "@/lib/types";

interface Props {
  params: Promise<{ inviteCode: string }>;
}

export default async function MarketInviteLandingPage({ params }: Props) {
  const { inviteCode } = await params;
  const market = await getMarketByInviteCode(inviteCode);

  if (!market) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-black">Market not found</p>
          <p className="text-muted-foreground text-sm mt-2">This invite link may have expired or is invalid.</p>
          {/* "/" works for a visitor in either auth state: it bounces a signed-in
              user straight to /dashboard and shows the landing page to everyone
              else, so a signed-out visitor with no account isn't left with
              nowhere to go. Same fix as app/bet/[inviteCode]/page.tsx. */}
          <Link href="/" className="text-primary text-sm mt-4 inline-block hover:underline">
            Go to Over/Under
          </Link>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Already trading here? Straight to the real market page. Unchanged from before.
  if (user) {
    const alreadyIn =
      market.creator_id === user.id || market.market_orders.some((o) => o.user_id === user.id);
    if (alreadyIn) redirect(`/markets/${market.id}`);
  }

  const creatorName = market.creator.display_name ?? market.creator.username;

  // Who is on each side, and how much they've actually put up. A market has
  // no pooled-stake row per user the way bet_participants does, so this is
  // reconstructed from market_fills -- an executed fill is a real position,
  // unlike a resting order which is only a standing offer. No new network
  // calls: market_fills and its yes_profile/no_profile embeds are already
  // part of BOOK_SELECT in lib/queries/markets.ts.
  const sortedFills = [...market.market_fills].sort((a, b) => a.created_at.localeCompare(b.created_at));

  function sideSummary(side: MarketSide): SideChoiceOption {
    const byUser = new Map<string, { name: string; costCents: number }>();
    for (const fill of sortedFills) {
      const userId = side === "yes" ? fill.yes_user_id : fill.no_user_id;
      const profile = side === "yes" ? fill.yes_profile : fill.no_profile;
      const priceCents = side === "yes" ? fill.yes_price : 100 - fill.yes_price;
      const existing = byUser.get(userId) ?? {
        name: profile.display_name ?? profile.username,
        costCents: 0,
      };
      existing.costCents += priceCents * fill.quantity;
      byUser.set(userId, existing);
    }
    const entries = [...byUser.values()];
    return {
      id: side,
      label: side === "yes" ? yesLabel : noLabel,
      total: entries.reduce((sum, e) => sum + e.costCents, 0) / 100,
      count: entries.length,
      names: entries.map((e) => e.name),
    };
  }

  const { yes_label: yesLabel, no_label: noLabel } = market;

  const sideChoiceOptions: SideChoiceOption[] = [sideSummary("yes"), sideSummary("no")];
  const volume = market.market_fills.reduce((sum, f) => sum + f.quantity, 0);

  // Check-on-read expiry, same idea as app/bet/[inviteCode]/page.tsx: a
  // market's `status` column only flips to a terminal state when someone
  // acts on it, but the deadline is a fact independent of that.
  const deadlinePassed = market.deadline != null && new Date(market.deadline).getTime() <= Date.now();
  const canTrade = (market.status === "open" || market.status === "active") && !deadlinePassed;

  const closedReason = deadlinePassed
    ? "The deadline for this market has passed."
    : market.status === "locked" || market.status === "resolving"
      ? "Trading is halted on this market while it resolves."
      : `This market is ${market.status} and no longer accepting orders.`;

  // Backing is a first-class fact here, not a detail: someone arriving at a
  // market invite link is deciding whether to take a position against a
  // stranger, and whether that stranger's money is actually there is the
  // most decision-relevant thing available. Vocabulary matches
  // components/market/CreateMarketForm.tsx lines ~112-150 verbatim.
  const backingLabel = market.backing === "usdc" ? "USDC" : "IOU";
  const backingBlurb =
    market.backing === "usdc"
      ? "Every order is backed by real funds held in escrow."
      : "Track who owes what, no deposit needed.";

  // "contracts pay $1 if right" is only true when the market actually holds
  // funds behind it -- accurate on a usdc market, misleading on an iou one,
  // so it's conditional on markets.backing rather than a fixed line.
  const payoutLine =
    market.backing === "usdc"
      ? "contracts pay $1 if right"
      : "contracts settle $1 if right, but Over/Under holds nothing — it's a debt between traders";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <p className="text-center text-sm font-black tracking-tight text-primary">OVER/UNDER</p>

        {/* The proposition is the page: market.title is the largest, heaviest
            text here on purpose -- last_price and volume drop to supporting
            detail below, mirroring the fix already made on the bet invite page. */}
        <Card className="border-primary/30">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-2xl font-black leading-tight">{market.title}</h1>
              <BetStatusBadge status={market.status} />
            </div>

            {market.description && <p className="text-sm text-muted-foreground">{market.description}</p>}

            {/* Backing -- visible without scrolling, never left to inference. */}
            <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-2">
              <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-black tracking-widest text-primary">
                {backingLabel}
              </span>
              <span className="text-xs text-muted-foreground">{backingBlurb}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{creatorName}</span> opened a market
              </p>
              {market.deadline && <CountdownTimer deadline={market.deadline} />}
            </div>

            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{market.last_price != null ? `Last traded at ${formatCents(market.last_price)}` : "No trades yet"}</span>
              <span>
                {volume} {volume === 1 ? "contract" : "contracts"} traded
              </span>
            </div>

            <p className="text-xs text-muted-foreground">{payoutLine}</p>
          </CardContent>
        </Card>

        {canTrade ? (
          <MarketInviteWager
            inviteCode={inviteCode}
            isSignedIn={Boolean(user)}
            yesLabel={market.yes_label}
            noLabel={market.no_label}
            options={sideChoiceOptions}
            orders={market.market_orders}
            maxContracts={market.max_contracts}
            deadline={market.deadline}
            backing={market.backing}
          />
        ) : (
          <div className="space-y-4">
            {/* Someone who followed a link deserves to see what happened, even
                once it's too late to trade. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
              {sideChoiceOptions.map((o) => (
                <div key={o.id} className="rounded-lg border border-border bg-secondary/40 p-3">
                  <p className="truncate text-sm font-bold leading-tight">{o.label}</p>
                  <p className="text-xs font-bold tabular-nums text-foreground">
                    {o.count > 0 ? formatCurrency(o.total) : "No one yet"}
                  </p>
                </div>
              ))}
            </div>
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">{closedReason}</p>
              <Link href="/" className="text-primary text-sm inline-block hover:underline">
                {user ? "Back to dashboard" : "Go to Over/Under"}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
