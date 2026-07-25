"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBet } from "@/lib/actions/bets";

export function CreateBetForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
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
            defaultValue="Yes"
            maxLength={50}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sideBLabel">Side B label</Label>
          <Input
            id="sideBLabel"
            name="sideBLabel"
            placeholder="No"
            defaultValue="No"
            maxLength={50}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="stake">Stake (USD)</Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
          <Input
            id="stake"
            name="stake"
            type="number"
            placeholder="20.00"
            min="0.01"
            max="100000"
            step="0.01"
            required
            className="pl-6"
          />
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full font-black text-base py-6" disabled={isPending}>
        {isPending ? "Creating…" : "Create Bet & Get Link"}
      </Button>
    </form>
  );
}
