"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { placeWager } from "@/lib/actions/bets";
import type { BetOption } from "@/lib/types";

interface WagerFormProps {
  identifier: { betId: string } | { inviteCode: string };
  options: BetOption[];
  minWager: number | null;
  maxWager: number | null;
  /** If the user already has a wager on this bet, lock the option and just let them add more. */
  existingOptionId?: string;
  existingAmount?: number;
}

export function WagerForm({
  identifier, options, minWager, maxWager, existingOptionId, existingAmount = 0,
}: WagerFormProps) {
  const sortedOptions = [...options].sort((a, b) => a.sort_order - b.sort_order);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optionId, setOptionId] = useState(existingOptionId ?? sortedOptions[0]?.id ?? "");

  const existingOption = sortedOptions.find((option) => option.id === existingOptionId);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const amount = Number(formData.get("amount"));
    startTransition(async () => {
      const result = await placeWager(identifier, existingOptionId ?? optionId, amount);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

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
          Adding to your <span className="font-bold text-foreground">{existingOption?.label}</span> wager
        </p>
      ) : (
        <div
          className={`grid gap-2 ${
            sortedOptions.length > 2
              ? "grid-cols-1 sm:grid-cols-2"
              : "grid-cols-2"
          }`}
        >
          {sortedOptions.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant={optionId === option.id ? "default" : "outline"}
              onClick={() => setOptionId(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}

      {sortedOptions.length === 0 && (
        <p className="text-sm text-destructive">
          This bet has no available options.
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="amount">
          {existingOptionId ? "Amount to add" : "Your wager"}
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
            max={existingOptionId ? remainingMax : maxWager ?? undefined}
            step="0.01"
            required
            className="pl-6"
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        type="submit"
        className="w-full font-black text-base py-6"
        disabled={
          isPending ||
          sortedOptions.length === 0 ||
          (existingOptionId != null && remainingMax === 0)
        }
      >
        {isPending ? "Placing wager…" : existingOptionId ? "Add to Wager" : "Place Wager"}
      </Button>
    </form>
  );
}
