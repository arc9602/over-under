import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getBetsForUser } from "@/lib/queries/bets";
import { getBetInvitesForUser } from "@/lib/queries/invites";
import { BetCard } from "@/components/bet/BetCard";
import { BetInviteNotifications } from "@/components/bet/BetInviteNotifications";
import { BetStatusBadge } from "@/components/bet/BetStatusBadge";
import { CountdownTimer } from "@/components/bet/CountdownTimer";
import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getBetOptions, getSideTotals, getOptionTotals } from "@/lib/utils/betPool";
import type { BetStatus, BetWithParticipants } from "@/lib/types";

const LIVE_STATUSES: BetStatus[] = ["open", "active", "locked", "resolving"];

// Mirrors BetCard's own state hierarchy (components/bet/BetCard.tsx) so a row
// never disagrees with the card it collapses into below md.
const TERMINAL_STATUSES: BetStatus[] = ["resolved", "cancelled", "expired", "stuck"];

const TABS: { value: string; label: string; statuses: BetStatus[] | "all" }[] = [
  { value: "all", label: "All", statuses: "all" },
  { value: "open", label: "Open", statuses: ["open"] },
  { value: "active", label: "Live", statuses: ["active", "locked", "resolving"] },
  { value: "resolved", label: "Settled", statuses: ["resolved", "cancelled", "expired", "stuck"] },
];

// Each tab explains what actually lands there once it's empty, rather than
// restating "no bets" back at someone who already knows the list is empty.
const EMPTY_STATE_COPY: Record<string, { title: string; description: string }> = {
  all: {
    title: "Start your first bet",
    description:
      "A bet has a title, two sides, and a deadline. Create one and share the invite link with whoever you're arguing with.",
  },
  open: {
    title: "No open bets",
    description: "Bets waiting for someone to take the other side land here, before any money is wagered.",
  },
  active: {
    title: "No live bets",
    description: "Bets with a wager on the line, from the first stake through resolution, show up here.",
  },
  resolved: {
    title: "No settled bets yet",
    description: "Bets land here once they're resolved, cancelled, or expired.",
  },
};

// Position-sheet ordering: what needs the user outranks what doesn't.
// Array.prototype.sort is a stable sort (guaranteed since ES2019), and
// getBetsForUser already returns bets newest-first, so ties within a rank
// keep that recency order for free -- no secondary key needed here.
function rankBet(bet: BetWithParticipants, userId: string): number {
  if (bet.status === "resolving") return 0;
  const isTerminal = TERMINAL_STATUSES.includes(bet.status);
  if (isTerminal) return 3;
  const hasStake = bet.bet_participants.some((p) => p.user_id === userId);
  return hasStake ? 1 : 2;
}

function sortBets(bets: BetWithParticipants[], userId: string) {
  return [...bets].sort((a, b) => rankBet(a, userId) - rankBet(b, userId));
}

// The dense row a bet collapses into at md and up. Carries the same fields
// as BetCard -- title, the user's side, stake, pool, deadline, status -- just
// laid out for scanning ten-plus at once instead of reading one at a time.
function BetRow({ bet, currentUserId }: { bet: BetWithParticipants; currentUserId: string }) {
  const options = getBetOptions(bet);
  const isTwoOption = options.length === 2;
  const sideA = getSideTotals(bet.bet_participants, "a");
  const sideB = getSideTotals(bet.bet_participants, "b");
  const optionTotals = options.map((o) => getOptionTotals(bet.bet_participants, o.id));
  const totalPool = isTwoOption
    ? sideA.total + sideB.total
    : optionTotals.reduce((sum, o) => sum + o.total, 0);

  const mine = bet.bet_participants.find((p) => p.user_id === currentUserId);
  const mySideLabel = !mine
    ? null
    : isTwoOption
    ? mine.side === "a"
      ? bet.side_a_label
      : bet.side_b_label
    : options.find((o) => o.id === mine.option_id)?.label ?? null;

  const isTerminal = TERMINAL_STATUSES.includes(bet.status);
  const isResolving = bet.status === "resolving";

  return (
    <Link
      href={`/bets/${bet.id}`}
      className={cn(
        "grid grid-cols-[1fr_10rem_6rem_6rem_6rem_6.5rem] items-center gap-4 px-4 py-3 transition-colors",
        // Same non-color-alone rule as BetCard: resolving reads through a
        // background tint (plus its badge), terminal through opacity.
        isTerminal ? "opacity-70 hover:bg-secondary/30" : "hover:bg-secondary/50",
        isResolving && "bg-resolving/10 hover:bg-resolving/15"
      )}
    >
      <span className={cn("font-medium text-sm truncate", isTerminal && "text-muted-foreground font-normal")}>
        {bet.title}
      </span>
      <span className="text-sm text-muted-foreground truncate">{mySideLabel ?? "—"}</span>
      <span
        className={cn(
          "text-right text-sm tabular-nums",
          mine && !isTerminal ? "font-semibold text-foreground" : "text-muted-foreground"
        )}
      >
        {mine ? formatCurrency(mine.amount) : "—"}
      </span>
      <span className="text-right text-sm tabular-nums text-muted-foreground">
        {totalPool > 0 ? formatCurrency(totalPool) : "—"}
      </span>
      <span className="text-right text-sm tabular-nums text-muted-foreground">
        {!isTerminal && bet.deadline ? <CountdownTimer deadline={bet.deadline} /> : "—"}
      </span>
      <span className="flex justify-end">
        <BetStatusBadge status={bet.status} />
      </span>
    </Link>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [bets, betInvites] = await Promise.all([
    getBetsForUser(user.id).catch(() => [] as BetWithParticipants[]),
    getBetInvitesForUser(user.id).catch(() => []),
  ]);

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
          <h1 className="text-2xl font-bold">My Bets</h1>
          {/* Exposure as context for the list beneath it, not a hero metric
              in its own boxes -- omitted entirely when there's nothing live
              to report, rather than printing "0 live". */}
          {liveBets.length > 0 && (
            <p className="text-muted-foreground text-sm mt-0.5 tabular-nums">
              {liveBets.length} live &middot; {formatCurrency(totalAtRisk)} at risk
            </p>
          )}
        </div>
        <Link href="/bets/new" className={buttonVariants({ className: "font-bold hidden sm:flex" })}>
          + New Bet
        </Link>
      </div>

      <BetInviteNotifications invites={betInvites} />

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
          const filtered = sortBets(filterBets(bets, tab.statuses), user.id);
          return (
            <TabsContent key={tab.value} value={tab.value} className="mt-4">
              {filtered.length === 0 ? (
                <EmptyState
                  title={EMPTY_STATE_COPY[tab.value].title}
                  description={EMPTY_STATE_COPY[tab.value].description}
                  ctaLabel={tab.value === "all" ? "New Bet" : undefined}
                  ctaHref={tab.value === "all" ? "/bets/new" : undefined}
                />
              ) : (
                <>
                  {/* Cards below md, where a six-column row has nowhere to go. */}
                  <div className="md:hidden space-y-3">
                    {filtered.map((bet) => (
                      <BetCard key={bet.id} bet={bet} currentUserId={user.id} />
                    ))}
                  </div>
                  {/* Rows from md up -- ten-plus visible at once instead of
                      three cards, per Operate's density guidance. */}
                  <div className="hidden md:block rounded-lg border border-border overflow-hidden">
                    <div className="grid grid-cols-[1fr_10rem_6rem_6rem_6rem_6.5rem] gap-4 px-4 py-2 text-xs text-muted-foreground border-b border-border">
                      <span>Bet</span>
                      <span>Your side</span>
                      <span className="text-right">Stake</span>
                      <span className="text-right">Pool</span>
                      <span className="text-right">Deadline</span>
                      <span className="text-right">Status</span>
                    </div>
                    <div className="divide-y divide-border">
                      {filtered.map((bet) => (
                        <BetRow key={bet.id} bet={bet} currentUserId={user.id} />
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
