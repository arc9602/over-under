"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createMarket } from "@/lib/actions/markets";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { CONTRACT_CENTS, centsToDollars, formatCents } from "@/lib/utils/marketBook";

export function CreateMarketForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [yesLabel, setYesLabel] = useState("Yes");
  const [noLabel, setNoLabel] = useState("No");
  const [seedBook, setSeedBook] = useState(false);
  const [openingSide, setOpeningSide] = useState<"yes" | "no">("yes");
  const [openingPrice, setOpeningPrice] = useState(50);
  const [openingQuantity, setOpeningQuantity] = useState(10);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    if (!seedBook) {
      formData.delete("openingSide");
      formData.delete("openingPrice");
      formData.delete("openingQuantity");
    } else {
      formData.set("openingSide", openingSide);
    }
    startTransition(async () => {
      const result = await createMarket(formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="title">What&apos;s the question?</Label>
        <Input
          id="title"
          name="title"
          placeholder="Will Jake be more than 15 mins late?"
          required
          minLength={3}
          maxLength={200}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">
          Resolution criteria <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Textarea
          id="description"
          name="description"
          placeholder="Exactly what counts as Yes, and who decides..."
          maxLength={500}
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="yesLabel">Yes side</Label>
          <Input
            id="yesLabel"
            name="yesLabel"
            placeholder="Yes"
            value={yesLabel}
            onChange={(e) => setYesLabel(e.target.value)}
            maxLength={50}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="noLabel">No side</Label>
          <Input
            id="noLabel"
            name="noLabel"
            placeholder="No"
            value={noLabel}
            onChange={(e) => setNoLabel(e.target.value)}
            maxLength={50}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="maxContracts">
            Max per side <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="maxContracts"
            name="maxContracts"
            type="number"
            placeholder="No limit"
            min="1"
            step="1"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="deadline">
            Deadline <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="deadline"
            name="deadline"
            type="datetime-local"
            min={new Date().toISOString().slice(0, 16)}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={seedBook}
            onChange={(e) => setSeedBook(e.target.checked)}
            className="accent-primary"
          />
          Post the first order
        </label>
        <p className="text-xs text-muted-foreground">
          An empty book has nothing to trade against. Posting an order gives whoever opens your
          invite link something to hit.
        </p>

        {seedBook && (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={openingSide === "yes" ? "default" : "outline"}
                onClick={() => setOpeningSide("yes")}
              >
                {yesLabel || "Yes"}
              </Button>
              <Button
                type="button"
                variant={openingSide === "no" ? "default" : "outline"}
                onClick={() => setOpeningSide("no")}
              >
                {noLabel || "No"}
              </Button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="openingPrice">Your price</Label>
                <span className="text-sm font-black text-primary tabular-nums">
                  {formatCents(openingPrice)}
                </span>
              </div>
              <input
                id="openingPrice"
                name="openingPrice"
                type="range"
                min={1}
                max={99}
                step={1}
                value={openingPrice}
                onChange={(e) => setOpeningPrice(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="openingQuantity">Contracts</Label>
              <Input
                id="openingQuantity"
                name="openingQuantity"
                type="number"
                min="1"
                step="1"
                value={openingQuantity}
                onChange={(e) =>
                  setOpeningQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                }
                required={seedBook}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Risks {formatCurrency(centsToDollars(openingPrice * openingQuantity))} to win{" "}
              {formatCurrency(
                centsToDollars((CONTRACT_CENTS - openingPrice) * openingQuantity)
              )}
              .
            </p>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full font-black text-base py-6" disabled={isPending}>
        {isPending ? "Creating…" : "Create Market & Get Link"}
      </Button>
    </form>
  );
}
