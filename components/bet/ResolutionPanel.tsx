"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { proposeResolution, confirmResolution, disputeResolution } from "@/lib/actions/resolutions";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import {
  getBetOptions,
  getOptionTotals,
  getPariMutuelPreview,
  getTotalPool,
} from "@/lib/utils/betPool";
import type { BetWithDetails } from "@/lib/types";

interface ResolutionPanelProps {
  bet: BetWithDetails;
  currentUserId: string;
  netIou?: number;
}

export function ResolutionPanel({ bet, currentUserId, netIou }: ResolutionPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const options = getBetOptions(bet);

  const pendingResolution = bet.resolutions.find((r) => r.status === "pending");

  function optionLabel(optionId: string) {
    return options.find((option) => option.id === optionId)?.label ?? "Unknown";
  }

  function handlePropose(winnerOptionId: string) {
    setError(null);
    startTransition(async () => {
      const result = await proposeResolution(bet.id, winnerOptionId);
      if (result?.error) setError(result.error);
    });
  }

  function handleConfirm() {
    if (!pendingResolution) return;
    setError(null);
    startTransition(async () => {
      const result = await confirmResolution(pendingResolution.id, bet.id);
      if (result?.error) setError(result.error);
    });
  }

  function handleDispute() {
    if (!pendingResolution) return;
    setError(null);
    startTransition(async () => {
      const result = await disputeResolution(pendingResolution.id, bet.id);
      if (result?.error) setError(result.error);
    });
  }

  if (bet.status === "resolved") {
    const confirmedResolution = bet.resolutions.find((r) => r.status === "confirmed");
    if (confirmedResolution) {
      const winnerOptionId =
        confirmedResolution.proposed_winner_option_id ??
        confirmedResolution.proposed_winner_side ??
        "";
      const label = optionLabel(winnerOptionId);
      const winningPool = getOptionTotals(
        bet.bet_participants,
        winnerOptionId
      ).total;
      const losingPool =
        getTotalPool(bet.bet_participants) - winningPool;
      const refunded = winningPool === 0 || losingPool === 0;

      if (refunded) {
        return (
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl mb-1">↩️</p>
              <p className="font-black text-lg">Wagers refunded</p>
              <p className="text-sm text-muted-foreground mt-1">
                <span className="font-medium text-foreground">{label}</span>{" "}
                won, but the winning or opposing pool was unfunded.
              </p>
            </CardContent>
          </Card>
        );
      }

      const net = netIou ?? 0;
      const won = net > 0;
      const broke_even = net === 0;
      return (
        <Card className={won ? "border-emerald-500/50 bg-emerald-500/5" : broke_even ? "" : "border-destructive/30 bg-destructive/5"}>
          <CardContent className="p-4 text-center">
            <p className="text-2xl mb-1">{won ? "🏆" : broke_even ? "🤝" : "💸"}</p>
            <p className="font-black text-lg">
              {broke_even ? "Break-even" : won ? `You net +${formatCurrency(net)}` : `You net −${formatCurrency(Math.abs(net))}`}
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
          <p className="text-xs font-black tracking-widest text-muted-foreground mb-3">WHO WON?</p>
          <div
            className={`grid gap-2 ${
              options.length > 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"
            }`}
          >
            {options.map((option) => {
              const preview = getPariMutuelPreview(bet.bet_participants, option.id, currentUserId);
              return (
                <Button
                  key={option.id}
                  variant="outline"
                  className="h-auto py-3 flex-col gap-1 hover:border-primary hover:bg-primary/5"
                  onClick={() => handlePropose(option.id)}
                  disabled={isPending}
                >
                  <span className="font-bold text-sm">{option.label}</span>
                  {preview.isParticipant && (
                    <span className={`text-xs ${preview.profit >= 0 ? "text-emerald-500" : "text-muted-foreground"}`}>
                      {preview.refunded
                        ? "Your wager would be refunded"
                        : preview.profit >= 0
                        ? `You'd net +${formatCurrency(preview.profit)}`
                        : `You'd lose ${formatCurrency(Math.abs(preview.profit))}`}
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  if (bet.status === "resolving" && pendingResolution) {
    const winnerOptionId =
      pendingResolution.proposed_winner_option_id ??
      pendingResolution.proposed_winner_side ??
      "";
    const label = optionLabel(winnerOptionId);
    const proposerProfile = bet.bet_participants.find(
      (p) => p.user_id === pendingResolution.proposed_by
    )?.profiles;
    const proposerName = proposerProfile?.display_name ?? proposerProfile?.username ?? "Someone";
    const isProposer = pendingResolution.proposed_by === currentUserId;
    const disputeCount = bet.resolutions.filter((r) => r.status === "disputed").length;

    if (isProposer) {
      return (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <p className="text-xs font-black tracking-widest text-amber-400 mb-2">AWAITING CONFIRMATION</p>
            <p className="text-sm">
              You proposed <span className="font-bold">{label}</span> as the winner.
            </p>
            <p className="text-xs text-muted-foreground mt-1">Waiting for another participant to confirm.</p>
            {error && <p className="text-sm text-destructive mt-2">{error}</p>}
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-4">
          <p className="text-xs font-black tracking-widest text-amber-400 mb-2">RESOLUTION PROPOSED</p>
          <p className="text-sm mb-4">
            {proposerName} says <span className="font-bold">{label}</span> won. Do you agree?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={handleConfirm} disabled={isPending} className="font-bold">
              ✓ Agree
            </Button>
            <Button
              onClick={handleDispute}
              disabled={isPending}
              variant="outline"
              className="font-bold text-destructive hover:text-destructive"
            >
              ✗ Dispute
              {disputeCount > 0 && (
                <span className="ml-1 text-[10px] text-muted-foreground">({3 - disputeCount} left)</span>
              )}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  return null;
}
