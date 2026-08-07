import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMarketsForUser } from "@/lib/queries/markets";
import { MarketCard } from "@/components/market/MarketCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";
import type { MarketStatus, MarketWithBook } from "@/lib/types";

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">Markets</h1>
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
