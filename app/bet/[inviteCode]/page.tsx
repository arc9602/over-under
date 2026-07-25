import { redirect } from "next/navigation";
import Link from "next/link";
import { getBetByInviteCode } from "@/lib/queries/bets";
import { createClient } from "@/lib/supabase/server";
import { joinBet } from "@/lib/actions/bets";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { BetStatusBadge } from "@/components/bet/BetStatusBadge";
import { CountdownTimer } from "@/components/bet/CountdownTimer";
import { formatCurrency } from "@/lib/utils/formatCurrency";

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

  // If already a participant, go to bet page
  if (user) {
    const isParticipant = bet.bet_participants.some((p) => p.user_id === user.id);
    if (isParticipant) redirect(`/bets/${bet.id}`);
  }

  const sideA = bet.bet_participants.find((p) => p.side === "a");
  const creatorName =
    sideA?.profiles?.display_name ?? sideA?.profiles?.username ?? "Someone";

  const canJoin = bet.status === "open";

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="text-xl font-black tracking-tight text-primary mb-1">OVER/UNDER</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{creatorName}</span> challenges you to a bet
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

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-secondary rounded p-2 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Side A (taken)</p>
                <p className="font-bold text-sm">{bet.side_a_label}</p>
                <p className="text-xs text-muted-foreground">{creatorName}</p>
              </div>
              <div className={`rounded p-2 text-center border ${canJoin ? "border-primary/40 bg-primary/5" : "bg-secondary"}`}>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Side B (yours)</p>
                <p className="font-bold text-sm">{bet.side_b_label}</p>
                <p className="text-xs text-primary">{canJoin ? "Take this side?" : "Filled"}</p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-2xl font-black text-primary">{formatCurrency(bet.stake)}</span>
              {bet.deadline && <CountdownTimer deadline={bet.deadline} />}
            </div>
          </CardContent>
        </Card>

        {canJoin ? (
          user ? (
            <form
              action={async () => {
                "use server";
                await joinBet(inviteCode);
              }}
            >
              <Button type="submit" className="w-full font-black text-base py-6">
                Accept the Bet
              </Button>
            </form>
          ) : (
            <div className="space-y-3">
              <Link
                href={`/signup?redirect=/bet/${inviteCode}`}
                className={buttonVariants({ className: "w-full font-black text-base py-6" })}
              >
                Sign Up to Accept
              </Link>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href={`/login?redirect=/bet/${inviteCode}`} className="text-primary hover:underline">
                  Sign in
                </Link>
              </p>
            </div>
          )
        ) : (
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              {bet.status === "active"
                ? "This bet is already live — both sides are filled."
                : `This bet is ${bet.status} and no longer accepting participants.`}
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
