import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMarketsForUser } from "@/lib/queries/markets";
import { MarketCard } from "@/components/market/MarketCard";
import { BetStatusBadge } from "@/components/bet/BetStatusBadge";
import { CountdownTimer } from "@/components/bet/CountdownTimer";
import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getPosition, getBestPrices, centsToDollars, formatCents } from "@/lib/utils/marketBook";
import type { MarketStatus, MarketWithBook } from "@/lib/types";

const TRADING_STATUSES: MarketStatus[] = ["open", "active", "locked", "resolving"];

// Mirrors BetRow's state hierarchy (app/(app)/dashboard/page.tsx) so a row
// never disagrees with the card it collapses into below md.
const TERMINAL_STATUSES: MarketStatus[] = ["resolved", "cancelled", "expired", "stuck"];

const TABS: { value: string; label: string; statuses: MarketStatus[] | "all" }[] = [
  { value: "all", label: "All", statuses: "all" },
  { value: "open", label: "Open", statuses: ["open"] },
  { value: "active", label: "Trading", statuses: ["active", "locked", "resolving"] },
  { value: "resolved", label: "Settled", statuses: ["resolved", "cancelled", "expired", "stuck"] },
];

// Position-sheet ordering: what needs the user outranks what doesn't.
// Array.prototype.sort is a stable sort (guaranteed since ES2019), and
// getMarketsForUser already returns markets newest-first, so ties within a
// rank keep that recency order for free -- no secondary key needed here.
function rankMarket(market: MarketWithBook, userId: string): number {
  if (market.status === "resolving") return 0;
  const isTerminal = TERMINAL_STATUSES.includes(market.status);
  if (isTerminal) return 3;
  const hasPosition = getPosition(market.market_fills, userId).hasPosition;
  return hasPosition ? 1 : 2;
}

function sortMarkets(markets: MarketWithBook[], userId: string) {
  return [...markets].sort((a, b) => rankMarket(a, userId) - rankMarket(b, userId));
}

// The dense row a market collapses into at md and up. Carries the same
// fields as MarketCard -- title, position, book prices, volume, deadline,
// status -- just laid out for scanning ten-plus at once instead of reading
// one at a time.
function MarketRow({ market, currentUserId, i }: { market: MarketWithBook; currentUserId: string; i: number }) {
  const position = getPosition(market.market_fills, currentUserId);
  const bestPrices = getBestPrices(market.market_orders);
  const volume = market.market_fills.reduce((sum, f) => sum + f.quantity, 0);

  const isTerminal = TERMINAL_STATUSES.includes(market.status);
  const isResolving = market.status === "resolving";

  return (
    <div className="dashboard-stagger-item" style={{ "--i": String(Math.min(i, 8)) } as CSSProperties}>
      <Link
        href={`/markets/${market.id}`}
        className={cn(
          "grid grid-cols-[1fr_10rem_7rem_5rem_6rem_6.5rem] items-center gap-4 px-4 py-3 transition-colors",
          // Same non-color-alone rule as MarketCard: resolving reads through a
          // background tint (plus its badge), terminal through opacity.
          isTerminal ? "opacity-70 hover:bg-secondary/30" : "hover:bg-secondary/50",
          isResolving && "bg-resolving/10 hover:bg-resolving/15"
        )}
      >
        {/* Backing rides with the title rather than taking a column of its own.
            Whether the other side of a trade is actually funded is the most
            decision-relevant fact about a market, so the desktop row must not
            show less than the mobile card does. */}
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate text-sm font-medium", isTerminal && "text-muted-foreground font-normal")}>
            {market.title}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] leading-none",
              market.backing === "usdc"
                ? "border-win/40 text-win"
                : "border-border text-muted-foreground"
            )}
          >
            {market.backing === "usdc" ? "USDC" : "IOU"}
          </span>
        </span>
        <span className="text-sm tabular-nums truncate">
          {!position.hasPosition ? (
            <span className="text-muted-foreground">—</span>
          ) : position.net === 0 ? (
            // Holding both sides in equal size -- the result is locked in
            // either way, same as PositionCard's "locked" case.
            <span className="text-muted-foreground">Flat</span>
          ) : position.net > 0 ? (
            <span className="text-win">
              {position.net} {market.yes_label}
            </span>
          ) : (
            <span className="text-loss">
              {Math.abs(position.net)} {market.no_label}
            </span>
          )}
        </span>
        <span className="text-right text-sm tabular-nums text-muted-foreground">
          {bestPrices.yes || bestPrices.no
            ? `${bestPrices.yes ? formatCents(bestPrices.yes.price) : "—"} / ${
                bestPrices.no ? formatCents(bestPrices.no.price) : "—"
              }`
            : "—"}
        </span>
        <span className="text-right text-sm tabular-nums text-muted-foreground">
          {volume > 0 ? volume : "—"}
        </span>
        <span className="text-right text-sm tabular-nums text-muted-foreground">
          {!isTerminal && market.deadline ? <CountdownTimer deadline={market.deadline} /> : "—"}
        </span>
        <span className="flex justify-end">
          <BetStatusBadge status={market.status} />
        </span>
      </Link>
    </div>
  );
}

export default async function MarketsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const markets = await getMarketsForUser(user.id).catch(() => [] as MarketWithBook[]);

  function filterMarkets(markets: MarketWithBook[], statuses: MarketStatus[] | "all") {
    if (statuses === "all") return markets;
    return markets.filter((m) => statuses.includes(m.status));
  }

  const tradingMarkets = filterMarkets(markets, TRADING_STATUSES);
  const totalAtRisk = tradingMarkets.reduce(
    (sum, market) => sum + centsToDollars(getPosition(market.market_fills, user.id).costCents),
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Markets</h1>
          {/* Exposure as context for the list beneath it, not a hero metric
              in its own boxes -- omitted entirely when nothing is trading,
              rather than printing "0 trading". */}
          {tradingMarkets.length > 0 && (
            <p className="text-muted-foreground text-sm mt-0.5 tabular-nums">
              {tradingMarkets.length} trading &middot; {formatCurrency(totalAtRisk)} at risk
            </p>
          )}
        </div>
        <Link
          href="/markets/new"
          className={buttonVariants({ className: "font-bold hidden sm:flex" })}
        >
          + New Market
        </Link>
      </div>

      <Tabs defaultValue="all">
        <TabsList className="w-full sm:w-auto">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex-1 sm:flex-none">
              {tab.label}
              {tab.statuses !== "all" && (
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  {filterMarkets(markets, tab.statuses).length}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((tab) => {
          const filtered = sortMarkets(filterMarkets(markets, tab.statuses), user.id);
          return (
            <TabsContent
              key={tab.value}
              value={tab.value}
              // Same starting-style fade as the dashboard's tabs -- see
              // app/(app)/dashboard/page.tsx for the Base UI note.
              className="mt-4 opacity-100 transition-opacity duration-150 ease-[var(--ease-out)] data-starting-style:opacity-0"
            >
              {filtered.length === 0 ? (
                <EmptyState
                  title="No markets here"
                  description={
                    tab.value === "all"
                      ? "Open a market and let your friends trade the odds."
                      : `No ${tab.label.toLowerCase()} markets.`
                  }
                  ctaLabel={tab.value === "all" ? "New Market" : undefined}
                  ctaHref={tab.value === "all" ? "/markets/new" : undefined}
                />
              ) : (
                <>
                  {/* Cards below md, where a six-column row has nowhere to go. */}
                  <div className="md:hidden space-y-3">
                    {filtered.map((market, i) => (
                      <div
                        key={market.id}
                        className="dashboard-stagger-item"
                        style={{ "--i": String(Math.min(i, 8)) } as CSSProperties}
                      >
                        <MarketCard market={market} currentUserId={user.id} />
                      </div>
                    ))}
                  </div>
                  {/* Rows from md up -- ten-plus visible at once instead of
                      three cards, per Operate's density guidance. */}
                  <div className="hidden md:block rounded-lg border border-border overflow-hidden">
                    <div className="grid grid-cols-[1fr_10rem_7rem_5rem_6rem_6.5rem] gap-4 px-4 py-2 text-xs text-muted-foreground border-b border-border">
                      <span>Market</span>
                      <span>Position</span>
                      <span className="text-right">Best prices</span>
                      <span className="text-right">Volume</span>
                      <span className="text-right">Deadline</span>
                      <span className="text-right">Status</span>
                    </div>
                    <div className="divide-y divide-border">
                      {filtered.map((market, i) => (
                        <MarketRow key={market.id} market={market} currentUserId={user.id} i={i} />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
