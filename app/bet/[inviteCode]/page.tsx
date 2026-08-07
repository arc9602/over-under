import { redirect } from "next/navigation";
import Link from "next/link";
import { getBetByInviteCode } from "@/lib/queries/bets";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { BetStatusBadge } from "@/components/bet/BetStatusBadge";
import { CountdownTimer } from "@/components/bet/CountdownTimer";
import { WagerForm } from "@/components/bet/WagerForm";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getOptionTotals, getTotalPool, sortBetOptions } from "@/lib/utils/betPool";

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
          <p className="text-2xl font-black">Bet not found</p>
          <p className="text-muted-foreground text-sm mt-2">This invite link may have expired or is invalid.</p>
          <Link href="/dashboard" className="text-primary text-sm mt-4 inline-block hover:underline">
            Go to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const isParticipant = bet.bet_participants.some((p) => p.user_id === user.id);
    if (isParticipant) redirect(`/bets/${bet.id}`);
  }

  const creatorName = bet.creator.display_name ?? bet.creator.username;
  const options = sortBetOptions(bet.bet_options);
  const totalPool = getTotalPool(bet.bet_participants);
  const canJoin = bet.status === "open" || bet.status === "active";

  const limits = [
    bet.min_wager != null ? `min ${formatCurrency(bet.min_wager)}` : null,
    bet.max_wager != null ? `max ${formatCurrency(bet.max_wager)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="text-xl font-black tracking-tight text-primary mb-1">OVER/UNDER</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{creatorName}</span> started a bet
          </p>
        </div>

        <Card className="border-primary/30">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-black text-lg leading-snug">{bet.title}</h2>
              <BetStatusBadge status={bet.status} />
            </div>

            {bet.description && (
              <p className="text-sm text-muted-foreground">{bet.description}</p>
            )}

            <div className={`grid gap-2 ${options.length > 2 ? "grid-cols-1" : "grid-cols-2"}`}>
              {options.map((option) => {
                const totals = getOptionTotals(bet.bet_participants, option.id);
                return (
                  <div key={option.id} className="bg-secondary rounded p-2 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{option.label}</p>
                    <p className="font-bold text-sm">{formatCurrency(totals.total)}</p>
                    <p className="text-xs text-muted-foreground">
                      {totals.count} {totals.count === 1 ? "person" : "people"}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-2xl font-black text-primary">{formatCurrency(totalPool)}</span>
              {bet.deadline && <CountdownTimer deadline={bet.deadline} />}
            </div>
            {limits && <p className="text-xs text-muted-foreground text-center">{limits}</p>}
          </CardContent>
        </Card>

        {canJoin ? (
          user ? (
            <WagerForm
              identifier={{ inviteCode }}
              options={bet.bet_options}
              minWager={bet.min_wager}
              maxWager={bet.max_wager}
            />
          ) : (
            <Link
              href={`/login?redirect=/bet/${inviteCode}`}
              className={buttonVariants({ className: "w-full font-black text-base py-6" })}
            >
              Continue with Google to Wager
            </Link>
          )
        ) : (
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              {bet.status === "locked" || bet.status === "resolving"
                ? "This bet is locked and no longer accepting wagers."
                : `This bet is ${bet.status} and no longer accepting wagers.`}
            </p>
            {user && (
              <Link href="/dashboard" className="text-primary text-sm mt-2 inline-block hover:underline">
                Back to dashboard
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
