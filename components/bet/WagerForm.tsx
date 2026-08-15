"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { placeWager } from "@/lib/actions/bets";
import { getPredictedPayout } from "@/lib/utils/betPool";
import { formatCurrency } from "@/lib/utils/formatCurrency";

interface WagerFormProps {
  identifier: { betId: string } | { inviteCode: string };
  sideALabel: string;
  sideBLabel: string;
  minWager: number | null;
  maxWager: number | null;
  /** Current pool totals, for the live predicted-payout preview. */
  sideATotal: number;
  sideBTotal: number;
  /** If the user already has a wager on this bet, lock the side and just let them add more. */
  existingSide?: "a" | "b";
  existingAmount?: number;
}

export function WagerForm({
  identifier, sideALabel, sideBLabel, minWager, maxWager, sideATotal, sideBTotal,
  existingSide, existingAmount = 0,
}: WagerFormProps) {
  const [isPending, startTransition] = useTransition();
  const [side, setSide] = useState<"a" | "b">(existingSide ?? "a");
  const [amountInput, setAmountInput] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const amount = Number(amountInput);
    startTransition(async () => {
      // On success this redirects, so only the failure path returns here.
      const result = await placeWager(identifier, existingSide ?? side, amount);
      if (result?.error) toast.error(result.error);
    });
  }

  const activeSide = existingSide ?? side;
  const activeSideLabel = activeSide === "a" ? sideALabel : sideBLabel;
  const mySideTotal = activeSide === "a" ? sideATotal : sideBTotal;
  const otherSideTotal = activeSide === "a" ? sideBTotal : sideATotal;
  const preview = getPredictedPayout(mySideTotal, otherSideTotal, existingAmount, Number(amountInput));

  // min/max apply to the cumulative wager, so for a top-up the remaining
  // room is what's left, not the raw bet-level limits.
  const remainingMax = maxWager != null ? Math.max(0, maxWager - existingAmount) : undefined;
  const limitsText = existingSide
    ? maxWager != null
      ? `up to $${remainingMax!.toFixed(2)} more (max $${maxWager.toFixed(2)} total)`
      : ""
    : [
        minWager != null ? `min $${minWager.toFixed(2)}` : null,
        maxWager != null ? `max $${maxWager.toFixed(2)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {existingSide ? (
        <p className="text-sm text-muted-foreground">
          Adding to your <span className="font-bold text-foreground">{existingSide === "a" ? sideALabel : sideBLabel}</span> wager
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant={side === "a" ? "default" : "outline"} onClick={() => setSide("a")}>
            {sideALabel}
          </Button>
          <Button type="button" variant={side === "b" ? "default" : "outline"} onClick={() => setSide("b")}>
            {sideBLabel}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="amount">
          {existingSide ? "Amount to add" : "Your wager"}
          {limitsText ? ` (${limitsText})` : ""}
        </Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
          <Input
            id="amount"
            name="amount"
            type="number"
            placeholder="20.00"
            min={0.01}
            max={existingSide ? remainingMax : maxWager ?? undefined}
            step="0.01"
            required
            className="pl-6"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
          />
        </div>
      </div>

      {preview && (
        <div className="rounded-lg bg-secondary/50 p-3 space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Predicted payout if {activeSideLabel} wins</span>
            <span className="font-black tabular-nums">{formatCurrency(preview.payout)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Profit</span>
            <span
              className={`font-bold tabular-nums ${
                preview.profit > 0 ? "text-win" : "text-muted-foreground"
              }`}
            >
              {preview.profit > 0 ? "+" : ""}
              {formatCurrency(preview.profit)}
            </span>
          </div>
          {otherSideTotal === 0 && (
            <p className="text-[11px] text-muted-foreground">
              No one's wagered {activeSide === "a" ? sideBLabel : sideALabel} yet, so you'd just get your stake back.
            </p>
          )}
        </div>
      )}

      <Button type="submit" className="w-full font-black text-base py-6" disabled={isPending}>
        {isPending ? "Placing wager…" : existingSide ? "Add to Wager" : "Place Wager"}
      </Button>
    </form>
  );
}
