import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBetById } from "@/lib/queries/bets";
import { getNetIouForBet } from "@/lib/queries/balances";
import { BetDetail } from "@/components/bet/BetDetail";
import { ResolutionPanel } from "@/components/bet/ResolutionPanel";
import { InviteSharePanel } from "@/components/bet/InviteSharePanel";
import { WagerForm } from "@/components/bet/WagerForm";
import { OptionWagerForm } from "@/components/bet/OptionWagerForm";
import { cancelBet, lockBet } from "@/lib/actions/bets";
import { getSideTotals, getBetOptions, getOptionTotals } from "@/lib/utils/betPool";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface Props {
  params: Promise<{ betId: string }>;
}

export default async function BetDetailPage({ params }: Props) {
  const { betId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const bet = await getBetById(betId);
  if (!bet) notFound();

  const isCreator = bet.creator_id === user.id;
  const myParticipation = bet.bet_participants.find((p) => p.user_id === user.id);
  if (!myParticipation && !isCreator) {
    // They may have the invite link — redirect there
    redirect(`/bet/${bet.invite_code}`);
  }

  const canCancel = isCreator && (bet.status === "open" || bet.status === "active");
  const canLock = isCreator && bet.status === "active";
  const canWager = bet.status === "open" || bet.status === "active";

  const netIou = bet.status === "resolved" ? await getNetIouForBet(betId, user.id) : undefined;

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <BetDetail bet={bet} currentUserId={user.id} />

      <Separator />

      {/* Invite panel — still accepting wagers */}
      {(bet.status === "open" || bet.status === "active") && (
        <InviteSharePanel inviteCode={bet.invite_code} />
      )}

      {canWager && (() => {
        const options = getBetOptions(bet);
        if (options.length === 2) {
          return (
            <WagerForm
              identifier={{ betId }}
              sideALabel={bet.side_a_label}
              sideBLabel={bet.side_b_label}
              minWager={bet.min_wager}
              maxWager={bet.max_wager}
              sideATotal={getSideTotals(bet.bet_participants, "a").total}
              sideBTotal={getSideTotals(bet.bet_participants, "b").total}
              existingSide={myParticipation?.side ?? undefined}
              existingAmount={myParticipation?.amount}
            />
          );
        }
        return (
          <OptionWagerForm
            identifier={{ betId }}
            options={options}
            optionTotals={Object.fromEntries(
              options.map((o) => [o.id, getOptionTotals(bet.bet_participants, o.id).total])
            )}
            minWager={bet.min_wager}
            maxWager={bet.max_wager}
            existingOptionId={myParticipation?.option_id ?? undefined}
            existingAmount={myParticipation?.amount}
          />
        );
      })()}

      {canLock && (
        <form
          action={async () => {
            "use server";
            await lockBet(betId);
          }}
        >
          <Button type="submit" className="w-full font-bold">
            Lock Bet &amp; Start Resolution
          </Button>
        </form>
      )}

      {/* Resolution panel */}
      {(bet.status === "locked" || bet.status === "resolving" || bet.status === "resolved" || bet.status === "stuck") && (
        <ResolutionPanel bet={bet} currentUserId={user.id} netIou={netIou} />
      )}

      {/* Cancel */}
      {canCancel && (
        <form
          action={async () => {
            "use server";
            await cancelBet(betId);
          }}
        >
          <Button type="submit" variant="outline" className="text-destructive hover:text-destructive w-full">
            Cancel Bet
          </Button>
        </form>
      )}
    </div>
  );
}
