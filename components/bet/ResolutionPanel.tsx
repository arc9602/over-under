"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { proposeResolution, confirmResolution, disputeResolution } from "@/lib/actions/resolutions";
import type { BetWithDetails } from "@/lib/types";

interface ResolutionPanelProps {
  bet: BetWithDetails;
  currentUserId: string;
}

export function ResolutionPanel({ bet, currentUserId }: ResolutionPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const pendingResolution = bet.resolutions.find((r) => r.status === "pending");
  const userSide = bet.bet_participants.find((p) => p.user_id === currentUserId)?.side;
  const sideA = bet.bet_participants.find((p) => p.side === "a");
  const sideB = bet.bet_participants.find((p) => p.side === "b");

  function getSideName(side: "a" | "b") {
    const p = side === "a" ? sideA : sideB;
    const label = side === "a" ? bet.side_a_label : bet.side_b_label;
    const name = p?.profiles?.display_name ?? p?.profiles?.username ?? "Unknown";
    return { label, name };
  }

  function handlePropose(winnerSide: "a" | "b") {
    setError(null);
    startTransition(async () => {
      const result = await proposeResolution(bet.id, winnerSide);
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
      const { label, name } = getSideName(confirmedResolution.proposed_winner_side);
      const youWon = bet.bet_participants.find(
        (p) => p.side === confirmedResolution.proposed_winner_side && p.user_id === currentUserId
      );
      return (
        <Card className={youWon ? "border-emerald-500/50 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"}>
          <CardContent className="p-4 text-center">
            <p className="text-2xl mb-1">{youWon ? "🏆" : "💸"}</p>
            <p className="font-black text-lg">{youWon ? "You won!" : "You lost"}</p>
            <p className="text-sm text-muted-foreground mt-1">
              <span className="font-medium text-foreground">{label}</span> won — {name}
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

  if (bet.status === "active") {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-black tracking-widest text-muted-foreground mb-3">WHO WON?</p>
          <div className="grid grid-cols-2 gap-2">
            {(["a", "b"] as const).map((side) => {
              const { label, name } = getSideName(side);
              return (
                <Button
                  key={side}
                  variant="outline"
                  className="h-auto py-3 flex-col gap-1 hover:border-primary hover:bg-primary/5"
                  onClick={() => handlePropose(side)}
                  disabled={isPending}
                >
                  <span className="font-bold text-sm">{label}</span>
                  <span className="text-xs text-muted-foreground">{name}</span>
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
    const { label, name } = getSideName(pendingResolution.proposed_winner_side);
    const isProposer = pendingResolution.proposed_by === currentUserId;
    const disputeCount = bet.resolutions.filter((r) => r.status === "disputed").length;

    if (isProposer) {
      return (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <p className="text-xs font-black tracking-widest text-amber-400 mb-2">AWAITING CONFIRMATION</p>
            <p className="text-sm">
              You proposed <span className="font-bold">{label}</span> ({name}) as the winner.
            </p>
            <p className="text-xs text-muted-foreground mt-1">Waiting for the other player to confirm.</p>
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
            Your opponent says <span className="font-bold">{label}</span> ({name}) won. Do you agree?
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
