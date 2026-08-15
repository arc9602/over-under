"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  proposeMarketResolution,
  confirmMarketResolution,
  disputeMarketResolution,
} from "@/lib/actions/marketResolutions";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getOutcomePreview, centsToDollars } from "@/lib/utils/marketBook";
import type { MarketSide, MarketWithDetails } from "@/lib/types";

interface MarketResolutionPanelProps {
  market: MarketWithDetails;
  currentUserId: string;
  netIou?: number;
}

export function MarketResolutionPanel({
  market,
  currentUserId,
  netIou,
}: MarketResolutionPanelProps) {
  const [isPending, startTransition] = useTransition();

  const pendingResolution = market.market_resolutions.find((r) => r.status === "pending");

  function outcomeLabel(outcome: MarketSide) {
    return outcome === "yes" ? market.yes_label : market.no_label;
  }

  function handlePropose(outcome: MarketSide) {
    startTransition(async () => {
      const result = await proposeMarketResolution(market.id, outcome);
      if (result?.error) toast.error(result.error);
      else toast.success(`Proposed ${outcomeLabel(outcome)}`, {
        description: "Another trader has to confirm before contracts pay out.",
      });
    });
  }

  function handleConfirm() {
    if (!pendingResolution) return;
    startTransition(async () => {
      const result = await confirmMarketResolution(pendingResolution.id, market.id);
      if (result?.error) toast.error(result.error);
      else toast.success("Market settled — contracts paid out at 100¢");
    });
  }

  function handleDispute() {
    if (!pendingResolution) return;
    startTransition(async () => {
      const result = await disputeMarketResolution(pendingResolution.id, market.id);
      if (result?.error) toast.error(result.error);
      else toast.info("Resolution disputed", {
        description: "The market is back to awaiting resolution.",
      });
    });
  }

  if (market.status === "resolved") {
    const confirmed = market.market_resolutions.find((r) => r.status === "confirmed");
    if (confirmed) {
      const label = outcomeLabel(confirmed.proposed_outcome);
      const net = netIou ?? 0;
      const won = net > 0;
      const brokeEven = net === 0;
      return (
        <Card
          className={
            won
              ? "border-win/50 bg-win/5"
              : brokeEven
              ? ""
              : "border-destructive/30 bg-destructive/5"
          }
        >
          <CardContent className="p-4 text-center">
            <p
              className={`font-black text-2xl tabular-nums ${
                brokeEven ? "" : won ? "text-win" : "text-destructive"
              }`}
            >
              {brokeEven
                ? "Break-even"
                : won
                ? `+${formatCurrency(net)}`
                : `−${formatCurrency(Math.abs(net))}`}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Settled at <span className="font-medium text-foreground">{label}</span> — contracts
              paid out at 100¢
            </p>
          </CardContent>
        </Card>
      );
    }
  }

  if (market.status === "stuck") {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="p-4 text-center">
          <p className="font-bold text-destructive">This market is stuck</p>
          <p className="text-sm text-muted-foreground mt-1">
            Too many disputes. Sort it out between yourselves and mark it settled in Balances.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (market.status === "locked") {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-black tracking-widest text-muted-foreground mb-3">
            HOW DID IT RESOLVE?
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(["yes", "no"] as const).map((outcome) => {
              const preview = getOutcomePreview(market.market_fills, currentUserId, outcome);
              return (
                <Button
                  key={outcome}
                  variant="outline"
                  className="h-auto py-3 flex-col gap-1 hover:border-primary hover:bg-primary/5"
                  onClick={() => handlePropose(outcome)}
                  disabled={isPending}
                >
                  <span className="font-bold text-sm truncate max-w-full">
                    {outcomeLabel(outcome)}
                  </span>
                  {preview.isParticipant && (
                    <span
                      className={`text-xs ${
                        preview.profitCents >= 0 ? "text-win" : "text-muted-foreground"
                      }`}
                    >
                      {preview.profitCents >= 0
                        ? `You'd net +${formatCurrency(centsToDollars(preview.profitCents))}`
                        : `You'd lose ${formatCurrency(
                            centsToDollars(Math.abs(preview.profitCents))
                          )}`}
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

  if (market.status === "resolving" && pendingResolution) {
    const label = outcomeLabel(pendingResolution.proposed_outcome);
    const isProposer = pendingResolution.proposed_by === currentUserId;
    const disputeCount = market.market_resolutions.filter((r) => r.status === "disputed").length;

    // The proposer may be the creator, who need not have traded, so look for
    // their name across both sides of the fills and fall back to the creator.
    const proposerProfile =
      market.market_fills.find((f) => f.yes_user_id === pendingResolution.proposed_by)?.yes_profile ??
      market.market_fills.find((f) => f.no_user_id === pendingResolution.proposed_by)?.no_profile ??
      (market.creator.id === pendingResolution.proposed_by ? market.creator : undefined);
    const proposerName = proposerProfile?.display_name ?? proposerProfile?.username ?? "Someone";

    if (isProposer) {
      return (
        <Card className="border-resolving/30 bg-resolving/5">
          <CardContent className="p-4">
            <p className="text-xs font-black tracking-widest text-resolving mb-2">
              AWAITING CONFIRMATION
            </p>
            <p className="text-sm">
              You proposed <span className="font-bold">{label}</span> as the outcome.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Waiting for another trader to confirm.
            </p>

          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="border-resolving/30 bg-resolving/5">
        <CardContent className="p-4">
          <p className="text-xs font-black tracking-widest text-resolving mb-2">
            RESOLUTION PROPOSED
          </p>
          <p className="text-sm mb-4">
            {proposerName} says this resolved <span className="font-bold">{label}</span>. Do you
            agree?
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
                <span className="ml-1 text-[10px] text-muted-foreground">
                  ({3 - disputeCount} left)
                </span>
              )}
            </Button>
          </div>

        </CardContent>
      </Card>
    );
  }

  return null;
}
