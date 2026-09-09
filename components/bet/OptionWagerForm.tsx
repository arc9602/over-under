"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { placeOptionWager } from "@/lib/actions/bets";
import { getPredictedPayout } from "@/lib/utils/betPool";
import { formatStake } from "@/lib/utils/formatStake";
import type { BetOption } from "@/lib/types";

/**
 * option_id-based counterpart of WagerForm, for a bet with 3+ options.
 * Deliberately a separate component rather than branching inside
 * WagerForm: the 2-option path is already working and well-exercised, and
 * has zero reason to carry a second, option_id-based code path through its
 * body just to share this file.
 */

interface OptionWagerFormProps {
  identifier: { betId: string } | { inviteCode: string };
  options: BetOption[];
  /** optionId -> total wagered on it so far. */
  optionTotals: Record<string, number>;
  minWager: number | null;
  maxWager: number | null;
  /** If the user already has a wager on this bet, lock the option and just let them add more. */
  /** What the stake is denominated in -- 'USD' is money (migration 022). */
  unit: string;
  unitPlural: string | null;
  existingOptionId?: string;
  existingAmount?: number;
}

export function OptionWagerForm({
  identifier, options, optionTotals, minWager, maxWager,
  unit, unitPlural, existingOptionId, existingAmount = 0,
}: OptionWagerFormProps) {
  // Amounts here are in the bet's own stake unit, not necessarily dollars.
  const stake = (amount: number) =>
    formatStake(amount, unit, unitPlural);

  const [isPending, startTransition] = useTransition();
  const [optionId, setOptionId] = useState<string>(existingOptionId ?? options[0]?.id ?? "");
  const [amountInput, setAmountInput] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const amount = Number(amountInput);
    startTransition(async () => {
      // On success this redirects, so only the failure path returns here.
      const result = await placeOptionWager(identifier, existingOptionId ?? optionId, amount);
      if (result?.error) toast.error(result.error);
    });
  }

  const activeOptionId = existingOptionId ?? optionId;
  const activeOption = options.find((o) => o.id === activeOptionId);
  const mySideTotal = optionTotals[activeOptionId] ?? 0;
  const otherTotal = options
    .filter((o) => o.id !== activeOptionId)
    .reduce((sum, o) => sum + (optionTotals[o.id] ?? 0), 0);
  const preview = getPredictedPayout(mySideTotal, otherTotal, existingAmount, Number(amountInput));

  // min/max apply to the cumulative wager, so for a top-up the remaining
  // room is what's left, not the raw bet-level limits.
  const remainingMax = maxWager != null ? Math.max(0, maxWager - existingAmount) : undefined;
  const limitsText = existingOptionId
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
      {existingOptionId ? (
        <p className="text-sm text-muted-foreground">
          Adding to your <span className="font-bold text-foreground">{activeOption?.label}</span> wager
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {options.map((o) => (
            <Button
              key={o.id}
              type="button"
              variant={optionId === o.id ? "default" : "outline"}
              onClick={() => setOptionId(o.id)}
              className="truncate"
            >
              {o.label}
            </Button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="option-amount">
          {existingOptionId ? "Amount to add" : "Your wager"}
          {limitsText ? ` (${limitsText})` : ""}
        </Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
          <Input
            id="option-amount"
            name="amount"
            type="number"
            placeholder="20.00"
            min={0.01}
            max={existingOptionId ? remainingMax : maxWager ?? undefined}
            step="0.01"
            required
            className="pl-6"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
          />
        </div>
      </div>

      {preview && activeOption && (
        <div className="rounded-lg bg-secondary/50 p-3 space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Predicted payout if {activeOption.label} wins</span>
            <span className="font-bold tabular-nums">{stake(preview.payout)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Profit</span>
            <span
              className={`font-bold tabular-nums ${
                preview.profit > 0 ? "text-win" : "text-muted-foreground"
              }`}
            >
              {preview.profit > 0 ? "+" : ""}
              {stake(preview.profit)}
            </span>
          </div>
          {otherTotal === 0 && (
            <p className="text-[11px] text-muted-foreground">
              No one's wagered another option yet, so you'd just get your stake back.
            </p>
          )}
        </div>
      )}

      <Button type="submit" className="w-full font-semibold text-base py-6" disabled={isPending}>
        {isPending ? "Placing wager…" : existingOptionId ? "Add to Wager" : "Place Wager"}
      </Button>
    </form>
  );
}
