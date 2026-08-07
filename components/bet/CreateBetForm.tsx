"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBet } from "@/lib/actions/bets";

export function CreateBetForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sideALabel, setSideALabel] = useState("Yes");
  const [sideBLabel, setSideBLabel] = useState("No");
  const [wagerNow, setWagerNow] = useState(false);
  const [creatorSide, setCreatorSide] = useState<"a" | "b">("a");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    if (!wagerNow) {
      formData.delete("creatorSide");
      formData.delete("creatorAmount");
    } else {
      formData.set("creatorSide", creatorSide);
    }
    startTransition(async () => {
      const result = await createBet(formData);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="title">What&apos;s the bet?</Label>
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
          Details <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Textarea
          id="description"
          name="description"
          placeholder="Any extra context or rules for judging this bet..."
          maxLength={500}
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="sideALabel">Side A label</Label>
          <Input
            id="sideALabel"
            name="sideALabel"
            placeholder="Yes"
            value={sideALabel}
            onChange={(e) => setSideALabel(e.target.value)}
            maxLength={50}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sideBLabel">Side B label</Label>
          <Input
            id="sideBLabel"
            name="sideBLabel"
            placeholder="No"
            value={sideBLabel}
            onChange={(e) => setSideBLabel(e.target.value)}
            maxLength={50}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="minWager">
            Min wager <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
            <Input
              id="minWager"
              name="minWager"
              type="number"
              placeholder="1.00"
              min="0.01"
              step="0.01"
              className="pl-6"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxWager">
            Max wager <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
            <Input
              id="maxWager"
              name="maxWager"
              type="number"
              placeholder="No limit"
              min="0.01"
              step="0.01"
              className="pl-6"
            />
          </div>
        </div>
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

      <div className="space-y-3 rounded-lg border border-border p-3">
        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={wagerNow}
            onChange={(e) => setWagerNow(e.target.checked)}
            className="accent-primary"
          />
          Wager on this myself now
        </label>

        {wagerNow && (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={creatorSide === "a" ? "default" : "outline"}
                onClick={() => setCreatorSide("a")}
              >
                {sideALabel || "Side A"}
              </Button>
              <Button
                type="button"
                variant={creatorSide === "b" ? "default" : "outline"}
                onClick={() => setCreatorSide("b")}
              >
                {sideBLabel || "Side B"}
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="creatorAmount">Your wager</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
                <Input
                  id="creatorAmount"
                  name="creatorAmount"
                  type="number"
                  placeholder="20.00"
                  min="0.01"
                  step="0.01"
                  className="pl-6"
                  required={wagerNow}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full font-black text-base py-6" disabled={isPending}>
        {isPending ? "Creating…" : "Create Bet & Get Link"}
      </Button>
    </form>
  );
}
