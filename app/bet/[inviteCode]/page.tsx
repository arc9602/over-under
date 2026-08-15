import { redirect } from "next/navigation";
import Link from "next/link";
import { getBetByInviteCode } from "@/lib/queries/bets";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { BetStatusBadge } from "@/components/bet/BetStatusBadge";
import { CountdownTimer } from "@/components/bet/CountdownTimer";
import { BetInviteWager } from "@/components/bet/BetInviteWager";
import type { SideChoiceOption } from "@/components/bet/SideChoice";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getSideTotals, getBetOptions, getOptionTotals } from "@/lib/utils/betPool";
import type { BetParticipant, Profile } from "@/lib/types";

interface Props {
  params: Promise<{ inviteCode: string }>;
}

export default async function InviteLandingPage({ params }: Props) {
  const { inviteCode } = await params;
  const bet = await getBetByInviteCode(inviteCode);

  if (!bet) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-bold">Bet not found</p>
          <p className="text-muted-foreground text-sm mt-2">This invite link may have expired or is invalid.</p>
          {/* "/" works for a visitor in either auth state: it bounces a signed-in
              user straight to /dashboard and shows the landing page to everyone
              else, so a signed-out visitor with no account isn't left with
              nowhere to go. */}
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

  // If already a participant, go to the real bet page. Unchanged from before.
  if (user) {
    const isParticipant = bet.bet_participants.some((p) => p.user_id === user.id);
    if (isParticipant) redirect(`/bets/${bet.id}`);
  }

  const options = getBetOptions(bet);
  const isTwoOption = options.length === 2;
  const creatorName = bet.creator.display_name ?? bet.creator.username;

  function namesFor(participants: (BetParticipant & { profiles: Profile })[]): string[] {
    return [...participants]
      .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
      .map((p) => p.profiles.display_name ?? p.profiles.username);
  }

  // Two-option bets are wagered on (and their participant rows keyed) by
  // `side`, not `option_id` -- place_wager never sets option_id, see
  // betPool.ts's note on getSideTotals. Reading totals/names through
  // getOptionTotals here would show every classic 2-option bet as empty.
  const sideChoiceOptions: SideChoiceOption[] = isTwoOption
    ? (["a", "b"] as const).map((side, i) => {
        const { total, count, rows } = getSideTotals(bet.bet_participants, side);
        return {
          id: options[i].id,
          label: side === "a" ? bet.side_a_label : bet.side_b_label,
          total,
          count,
          names: namesFor(rows),
        };
      })
    : options.map((o) => {
        const { total, count, rows } = getOptionTotals(bet.bet_participants, o.id);
        return { id: o.id, label: o.label, total, count, names: namesFor(rows) };
      });

  const totalPool = sideChoiceOptions.reduce((sum, o) => sum + o.total, 0);

  // Check-on-read expiry, same idea as getBetsForUser: a bet's `status`
  // column only flips to a terminal state when someone acts on it, but the
  // deadline is a fact independent of that -- so a bet can be well past its
  // deadline while the DB still says "open". canJoin has to account for both.
  const deadlinePassed = bet.deadline != null && new Date(bet.deadline).getTime() <= Date.now();
  const canJoin = (bet.status === "open" || bet.status === "active") && !deadlinePassed;

  const limits = [
    bet.min_wager != null ? `min ${formatCurrency(bet.min_wager)}` : null,
    bet.max_wager != null ? `max ${formatCurrency(bet.max_wager)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const closedReason = deadlinePassed
    ? "The deadline for this bet has passed."
    : bet.status === "locked" || bet.status === "resolving"
      ? "This bet is locked and no longer accepting wagers."
      : `This bet is ${bet.status} and no longer accepting wagers.`;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <p className="text-center text-sm font-black tracking-tight text-primary">OVER/UNDER</p>

        {/* The proposition is the page: bet.title is the largest, heaviest
            text here on purpose -- everything else (who proposed it, the
            pool, the sign-in) is scaffolding around this one claim. */}
        <Card className="border-primary/30">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-2xl font-black leading-tight">{bet.title}</h1>
              <BetStatusBadge status={bet.status} />
            </div>

            {bet.description && <p className="text-sm text-muted-foreground">{bet.description}</p>}

            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{creatorName}</span> started a bet
              </p>
              {bet.deadline && <CountdownTimer deadline={bet.deadline} />}
            </div>

            {(totalPool > 0 || limits) && (
              <p className="text-xs text-muted-foreground">
                {totalPool > 0 ? `${formatCurrency(totalPool)} wagered so far` : null}
                {totalPool > 0 && limits ? " · " : null}
                {limits}
              </p>
            )}
          </CardContent>
        </Card>

        {canJoin ? (
          <BetInviteWager
            inviteCode={inviteCode}
            isSignedIn={Boolean(user)}
            isTwoOption={isTwoOption}
            options={sideChoiceOptions}
            minWager={bet.min_wager}
            maxWager={bet.max_wager}
            deadline={bet.deadline}
            creatorName={creatorName}
          />
        ) : (
          <div className="space-y-4">
            {/* Someone who followed a link deserves to see what happened, even
                once it's too late to join. */}
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
