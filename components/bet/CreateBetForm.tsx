"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Stepper } from "@/components/shared/Stepper";
import { createBet } from "@/lib/actions/bets";
import { formatCurrency } from "@/lib/utils/formatCurrency";

/**
 * Four-step bet builder, mirroring CreateMarketForm step-for-step so both
 * creation flows read the same. Fields live in component state because
 * inputs on hidden steps would otherwise unmount and lose their values
 * before submit; createBet still receives the same FormData keys.
 */

const STEPS = ["Details", "Sides", "Rules", "Review"];

export function CreateBetForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sideALabel, setSideALabel] = useState("Yes");
  const [sideBLabel, setSideBLabel] = useState("No");
  const [minWager, setMinWager] = useState("");
  const [maxWager, setMaxWager] = useState("");
  const [deadline, setDeadline] = useState("");
  const [wagerNow, setWagerNow] = useState(false);
  const [creatorSide, setCreatorSide] = useState<"a" | "b">("a");
  const [creatorAmount, setCreatorAmount] = useState("");

  const titleValid = title.trim().length >= 3;
  const labelsValid = sideALabel.trim().length > 0 && sideBLabel.trim().length > 0;
  const wagerValid = !wagerNow || Number(creatorAmount) > 0;
  const canAdvance = step === 0 ? titleValid : step === 1 ? labelsValid : wagerValid;

  function handleSubmit() {
    setError(null);
    const formData = new FormData();
    formData.set("title", title.trim());
    if (description.trim()) formData.set("description", description.trim());
    formData.set("sideALabel", sideALabel.trim());
    formData.set("sideBLabel", sideBLabel.trim());
    if (minWager) formData.set("minWager", minWager);
    if (maxWager) formData.set("maxWager", maxWager);
    if (deadline) formData.set("deadline", deadline);
    if (wagerNow && Number(creatorAmount) > 0) {
      formData.set("creatorSide", creatorSide);
      formData.set("creatorAmount", creatorAmount);
    }

    startTransition(async () => {
      const result = await createBet(formData);
      if (result?.error) {
        setError(result.error);
        setStep(0);
      }
    });
  }

  return (
    <div className="space-y-6">
      <Stepper steps={STEPS} currentIndex={step} />

      {step === 0 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-black">What&apos;s the bet?</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Define the event clearly to avoid disputes later.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Bet title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Will Jake be more than 15 mins late?"
              maxLength={200}
              autoFocus
            />
            {title.length > 0 && !titleValid && (
              <p className="text-xs text-muted-foreground">At least 3 characters.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add any relevant context or rules for judging this bet…"
              maxLength={500}
              rows={3}
            />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-black">What are the sides?</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Name both sides. Everyone picks one and stakes into the pool.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sideALabel">Side A</Label>
              <Input
                id="sideALabel"
                value={sideALabel}
                onChange={(e) => setSideALabel(e.target.value)}
                placeholder="Yes"
                maxLength={50}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sideBLabel">Side B</Label>
              <Input
                id="sideBLabel"
                value={sideBLabel}
                onChange={(e) => setSideBLabel(e.target.value)}
                placeholder="No"
                maxLength={50}
              />
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-black">Set the rules</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Optionally cap the stakes, set a deadline, and wager now.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="minWager">
                Min wager <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">
                  $
                </span>
                <Input
                  id="minWager"
                  type="number"
                  value={minWager}
                  onChange={(e) => setMinWager(e.target.value)}
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
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">
                  $
                </span>
                <Input
                  id="maxWager"
                  type="number"
                  value={maxWager}
                  onChange={(e) => setMaxWager(e.target.value)}
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
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
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
            <p className="text-xs text-muted-foreground">
              A bet with money on only one side has nothing to settle against. Staking now gives
              whoever opens your invite link something to take.
            </p>

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
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">
                      $
                    </span>
                    <Input
                      id="creatorAmount"
                      type="number"
                      value={creatorAmount}
                      onChange={(e) => setCreatorAmount(e.target.value)}
                      placeholder="20.00"
                      min="0.01"
                      step="0.01"
                      className="pl-6"
                    />
                  </div>
                </div>

                {Number(creatorAmount) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Stakes {formatCurrency(Number(creatorAmount))}. Your payout grows as people
                    take the other side.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-black">Ready to open?</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              You&apos;ll get a private invite link to share.
            </p>
          </div>

          <dl className="rounded-lg border border-border divide-y divide-border text-sm">
            <div className="flex items-start justify-between gap-4 p-3">
              <dt className="text-muted-foreground shrink-0">Bet</dt>
              <dd className="font-medium text-right">{title.trim() || "—"}</dd>
            </div>
            {description.trim() && (
              <div className="flex items-start justify-between gap-4 p-3">
                <dt className="text-muted-foreground shrink-0">Description</dt>
                <dd className="text-right text-muted-foreground">{description.trim()}</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Sides</dt>
              <dd className="font-medium">
                <span className="text-emerald-400">{sideALabel.trim()}</span>
                {" / "}
                <span className="text-rose-400">{sideBLabel.trim()}</span>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Wager limits</dt>
              <dd className="font-medium">
                {[
                  minWager ? `min ${formatCurrency(Number(minWager))}` : null,
                  maxWager ? `max ${formatCurrency(Number(maxWager))}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "None"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Deadline</dt>
              <dd className="font-medium">
                {deadline ? new Date(deadline).toLocaleString() : "None"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Your wager</dt>
              <dd className="font-medium">
                {wagerNow && Number(creatorAmount) > 0
                  ? `${formatCurrency(Number(creatorAmount))} on ${
                      creatorSide === "a" ? sideALabel : sideBLabel
                    }`
                  : "None"}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        {step > 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep((s) => s - 1)}
            disabled={isPending}
            className="font-bold"
          >
            Back
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canAdvance}
            className="font-bold ml-auto"
          >
            Next
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !titleValid || !labelsValid || !wagerValid}
            className="font-black ml-auto"
          >
            {isPending ? "Creating…" : "Create Bet & Get Link"}
          </Button>
        )}
      </div>
    </div>
  );
}
