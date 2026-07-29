import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getBetsForUser } from "@/lib/queries/bets";
import { BetCard } from "@/components/bet/BetCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";
import type { BetStatus, BetWithParticipants } from "@/lib/types";

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">My Bets</h1>
        <Link href="/bets/new" className={buttonVariants({ className: "font-bold hidden sm:flex" })}>
          + New Bet
        </Link>
      </div>

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
