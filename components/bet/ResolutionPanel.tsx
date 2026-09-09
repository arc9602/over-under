"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  proposeResolution,
  confirmResolution,
  disputeResolution,
  proposeOptionResolution,
  confirmOptionResolution,
} from "@/lib/actions/resolutions";
import { formatStake } from "@/lib/utils/formatStake";
import { getPariMutuelPreview, getOptionPariMutuelPreview, getBetOptions } from "@/lib/utils/betPool";
import type { BetWithDetails } from "@/lib/types";

interface ResolutionPanelProps {
  bet: BetWithDetails;
  currentUserId: string;
  netIou?: number;
}

export function ResolutionPanel({ bet, currentUserId, netIou }: ResolutionPanelProps) {
  // Bets can be staked in something other than money (migration 022);
  // every amount on this screen is denominated in the bet's own unit.
  const stake = (amount: number) =>
    formatStake(amount, bet.stake_unit, bet.stake_unit_plural);

  const [isPending, startTransition] = useTransition();

  const options = getBetOptions(bet);
  const isTwoOption = options.length === 2;
  const pendingResolution = bet.resolutions.find((r) => r.status === "pending");
  // dispute_resolution is shared by both paths (see lib/actions/resolutions.ts),
  // so this is the only place that needs to tell them apart.
  const isOptionResolution = (r: BetWithDetails["resolutions"][number]) =>
    r.proposed_winner_option_id != null;

  function sideLabel(side: "a" | "b") {
    return side === "a" ? bet.side_a_label : bet.side_b_label;
  }

  function optionLabel(optionId: string) {
    return options.find((o) => o.id === optionId)?.label ?? "Unknown option";
  }

  function handlePropose(winnerSide: "a" | "b") {
    startTransition(async () => {
      const result = await proposeResolution(bet.id, winnerSide);
      if (result?.error) toast.error(result.error);
      else toast.success(`Proposed ${sideLabel(winnerSide)} as the winner`, {
        description: "Another participant has to confirm before it settles.",
      });
    });
  }

  function handleProposeOption(winnerOptionId: string) {
    startTransition(async () => {
      const result = await proposeOptionResolution(bet.id, winnerOptionId);
      if (result?.error) toast.error(result.error);
      else toast.success(`Proposed ${optionLabel(winnerOptionId)} as the winner`, {
        description: "Another participant has to confirm before it settles.",
      });
    });
  }

  function handleConfirm() {
    if (!pendingResolution) return;
    startTransition(async () => {
      const result = isOptionResolution(pendingResolution)
        ? await confirmOptionResolution(pendingResolution.id, bet.id)
        : await confirmResolution(pendingResolution.id, bet.id);
      if (result?.error) toast.error(result.error);
      else toast.success("Bet settled — IOUs recorded");
    });
  }

  function handleDispute() {
    if (!pendingResolution) return;
    startTransition(async () => {
      const result = await disputeResolution(pendingResolution.id, bet.id);
      if (result?.error) toast.error(result.error);
      else toast.info("Resolution disputed", {
        description: "The bet is back to awaiting resolution.",
      });
    });
  }

  if (bet.status === "resolved") {
    const confirmedResolution = bet.resolutions.find((r) => r.status === "confirmed");
    if (confirmedResolution) {
      const label = confirmedResolution.proposed_winner_option_id != null
        ? optionLabel(confirmedResolution.proposed_winner_option_id)
        : sideLabel(confirmedResolution.proposed_winner_side!);
      const net = netIou ?? 0;
      const won = net > 0;
      const broke_even = net === 0;
      return (
        <Card className={won ? "border-win/50 bg-win/5" : broke_even ? "" : "border-destructive/30 bg-destructive/5"}>
          <CardContent className="p-4 text-center">
            <p
              className={`font-semibold text-2xl tabular-nums ${
                broke_even ? "" : won ? "text-win" : "text-destructive"
              }`}
            >
              {broke_even
                ? "Break-even"
                : won
                ? `+${stake(net)}`
                : `−${stake(Math.abs(net))}`}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              <span className="font-medium text-foreground">{label}</span> won
            </p>
          </CardContent>
        </Card>
      );
    }
  }

  if (bet.status === "stuck") {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="p-4 text-center">
          <p className="font-bold text-destructive">This bet is stuck</p>
          <p className="text-sm text-muted-foreground mt-1">
            Too many disputes. Sort it out between yourselves and mark it settled in Balances.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (bet.status === "locked") {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground mb-3">WHO WON?</p>
          <div className="grid grid-cols-2 gap-2">
            {isTwoOption
              ? (["a", "b"] as const).map((side) => {
                  const preview = getPariMutuelPreview(bet.bet_participants, side, currentUserId);
                  return (
                    <Button
                      key={side}
                      variant="outline"
                      className="h-auto py-3 flex-col gap-1 hover:border-primary hover:bg-primary/5"
                      onClick={() => handlePropose(side)}
                      disabled={isPending}
                    >
                      <span className="font-bold text-sm">{sideLabel(side)}</span>
                      {preview.isParticipant && (
                        <span className={`text-xs ${preview.profit >= 0 ? "text-win" : "text-muted-foreground"}`}>
                          {preview.profit >= 0
                            ? `You'd net +${stake(preview.profit)}`
                            : `You'd lose ${stake(Math.abs(preview.profit))}`}
                        </span>
                      )}
                    </Button>
                  );
                })
              : options.map((option) => {
                  const preview = getOptionPariMutuelPreview(bet.bet_participants, option.id, currentUserId);
                  return (
                    <Button
                      key={option.id}
                      variant="outline"
                      className="h-auto py-3 flex-col gap-1 hover:border-primary hover:bg-primary/5"
                      onClick={() => handleProposeOption(option.id)}
                      disabled={isPending}
                    >
                      <span className="font-bold text-sm truncate max-w-full">{option.label}</span>
                      {preview.isParticipant && (
                        <span className={`text-xs ${preview.profit >= 0 ? "text-win" : "text-muted-foreground"}`}>
                          {preview.profit >= 0
                            ? `You'd net +${stake(preview.profit)}`
                            : `You'd lose ${stake(Math.abs(preview.profit))}`}
                        </span>
                      )}
                    </Button>
                  );
                })}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (bet.status === "resolving" && pendingResolution) {
    const label = pendingResolution.proposed_winner_option_id != null
      ? optionLabel(pendingResolution.proposed_winner_option_id)
      : sideLabel(pendingResolution.proposed_winner_side!);
    const proposerProfile = bet.bet_participants.find(
      (p) => p.user_id === pendingResolution.proposed_by
    )?.profiles;
    const proposerName = proposerProfile?.display_name ?? proposerProfile?.username ?? "Someone";
    const isProposer = pendingResolution.proposed_by === currentUserId;
    const disputeCount = bet.resolutions.filter((r) => r.status === "disputed").length;

    if (isProposer) {
      return (
        <Card className="border-resolving/30 bg-resolving/5">
          <CardContent className="p-4">
            <p className="text-xs font-semibold tracking-widest text-resolving mb-2">AWAITING CONFIRMATION</p>
            <p className="text-sm">
              You proposed <span className="font-bold">{label}</span> as the winner.
            </p>
            <p className="text-xs text-muted-foreground mt-1">Waiting for another participant to confirm.</p>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="border-resolving/30 bg-resolving/5">
        <CardContent className="p-4">
          <p className="text-xs font-semibold tracking-widest text-resolving mb-2">RESOLUTION PROPOSED</p>
          <p className="text-sm mb-4">
            {proposerName} says <span className="font-bold">{label}</span> won. Do you agree?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={handleConfirm} disabled={isPending} className="font-bold">
              <Check className="size-4" />
              Agree
            </Button>
            <Button
              onClick={handleDispute}
              disabled={isPending}
              variant="outline"
              className="font-bold text-destructive hover:text-destructive"
            >
              <X className="size-4" />
              Dispute
              {disputeCount > 0 && (
                <span className="ml-1 text-[10px] text-muted-foreground">({3 - disputeCount} left)</span>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
