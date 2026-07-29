"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { placeWager } from "@/lib/actions/bets";

interface WagerFormProps {
  identifier: { betId: string } | { inviteCode: string };
  sideALabel: string;
  sideBLabel: string;
  minWager: number | null;
  maxWager: number | null;
  /** If the user already has a wager on this bet, lock the side and just let them add more. */
  existingSide?: "a" | "b";
}

export function WagerForm({
  identifier, sideALabel, sideBLabel, minWager, maxWager, existingSide,
}: WagerFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<"a" | "b">(existingSide ?? "a");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const amount = Number(formData.get("amount"));
    startTransition(async () => {
      const result = await placeWager(identifier, existingSide ?? side, amount);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  const limitsText = [
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
            min={minWager ?? 0.01}
            max={maxWager ?? undefined}
            step="0.01"
            required
            className="pl-6"
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full font-black text-base py-6" disabled={isPending}>
        {isPending ? "Placing wager…" : existingSide ? "Add to Wager" : "Place Wager"}
      </Button>
    </form>
  );
}
