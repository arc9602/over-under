import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getBetsForUser } from "@/lib/queries/bets";
import { BetCard } from "@/components/bet/BetCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import type { BetStatus, BetWithParticipants } from "@/lib/types";

const LIVE_STATUSES: BetStatus[] = ["open", "active", "locked", "resolving"];

const TABS: { value: string; label: string; statuses: BetStatus[] | "all" }[] = [
  { value: "all", label: "All", statuses: "all" },
  { value: "open", label: "Open", statuses: ["open"] },
  { value: "active", label: "Live", statuses: ["active", "locked", "resolving"] },
  { value: "resolved", label: "Settled", statuses: ["resolved", "cancelled", "expired", "stuck"] },
];

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const bets = await getBetsForUser(user.id).catch(() => [] as BetWithParticipants[]);

  function filterBets(bets: BetWithParticipants[], statuses: BetStatus[] | "all") {
    if (statuses === "all") return bets;
    return bets.filter((b) => statuses.includes(b.status));
  }

  const liveBets = filterBets(bets, LIVE_STATUSES);
  const totalAtRisk = liveBets.reduce((sum, bet) => {
    const mine = bet.bet_participants.find((p) => p.user_id === user.id);
    return sum + (mine?.amount ?? 0);
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black">My Bets</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Private prediction markets with friends
          </p>
        </div>
        <Link href="/bets/new" className={buttonVariants({ className: "font-bold hidden sm:flex" })}>
          + New Bet
        </Link>
      </div>

      {bets.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Live Bets</p>
              <p className="text-xl font-black tabular-nums">{liveBets.length}</p>
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
                  {filterBets(bets, tab.statuses).length}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((tab) => {
          const filtered = filterBets(bets, tab.statuses);
          return (
            <TabsContent key={tab.value} value={tab.value} className="mt-4 space-y-3">
              {filtered.length === 0 ? (
                <EmptyState
                  title="No bets here"
                  description={
                    tab.value === "all"
                      ? "Create your first bet and challenge a friend."
                      : `No ${tab.label.toLowerCase()} bets.`
                  }
                  ctaLabel={tab.value === "all" ? "New Bet" : undefined}
                  ctaHref={tab.value === "all" ? "/bets/new" : undefined}
                />
              ) : (
                filtered.map((bet) => (
                  <BetCard key={bet.id} bet={bet} currentUserId={user.id} />
                ))
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
