import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMarketsForUser } from "@/lib/queries/markets";
import { MarketCard } from "@/components/market/MarketCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getPosition, centsToDollars } from "@/lib/utils/marketBook";
import type { MarketStatus, MarketWithBook } from "@/lib/types";

const TRADING_STATUSES: MarketStatus[] = ["open", "active", "locked", "resolving"];

const TABS: { value: string; label: string; statuses: MarketStatus[] | "all" }[] = [
  { value: "all", label: "All", statuses: "all" },
  { value: "open", label: "Open", statuses: ["open"] },
  { value: "active", label: "Trading", statuses: ["active", "locked", "resolving"] },
  { value: "resolved", label: "Settled", statuses: ["resolved", "cancelled", "expired", "stuck"] },
];

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
          <h1 className="text-2xl font-black">Markets</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Trade the odds with your friends
          </p>
        </div>
        <Link
          href="/markets/new"
          className={buttonVariants({ className: "font-bold hidden sm:flex" })}
        >
          + New Market
        </Link>
      </div>

      {markets.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Trading</p>
              <p className="text-xl font-black tabular-nums">{tradingMarkets.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">At Risk</p>
              <p className="text-xl font-black tabular-nums text-primary">
                {formatCurrency(totalAtRisk)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

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
          const filtered = filterMarkets(markets, tab.statuses);
          return (
            <TabsContent key={tab.value} value={tab.value} className="mt-4 space-y-3">
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
                filtered.map((market) => (
                  <MarketCard key={market.id} market={market} currentUserId={user.id} />
                ))
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
