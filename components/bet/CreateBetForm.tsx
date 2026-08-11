"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Stepper } from "@/components/shared/Stepper";
import { createBet, createBetWithOptions } from "@/lib/actions/bets";
import { formatCurrency } from "@/lib/utils/formatCurrency";

/**
 * Four-step bet builder, mirroring CreateMarketForm step-for-step so both
 * creation flows read the same. Fields live in component state because
 * inputs on hidden steps would otherwise unmount and lose their values
 * before submit.
 *
 * Step 2 is a dynamic 2-10 option list rather than a fixed Side A/Side B
 * pair. Exactly 2 options submits through createBet (byte-identical
 * behavior to before this existed); 3+ submits through
 * createBetWithOptions. "Wager on this myself now" only applies to the
 * 2-option case -- see its condition below for why.
 */

const STEPS = ["Details", "Sides", "Rules", "Review"];
const MAX_OPTIONS = 10;

export function CreateBetForm() {
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(0);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState(["Yes", "No"]);
  const [minWager, setMinWager] = useState("");
  const [maxWager, setMaxWager] = useState("");
  const [deadline, setDeadline] = useState("");
  const [wagerNow, setWagerNow] = useState(false);
  const [creatorSide, setCreatorSide] = useState<"a" | "b">("a");
  const [creatorAmount, setCreatorAmount] = useState("");

  const isTwoOption = options.length === 2;
  const trimmedOptions = options.map((o) => o.trim());
  const titleValid = title.trim().length >= 3;
  const labelsValid =
    trimmedOptions.every((o) => o.length > 0) &&
    new Set(trimmedOptions.map((o) => o.toLowerCase())).size === trimmedOptions.length;
  const wagerValid = !wagerNow || !isTwoOption || Number(creatorAmount) > 0;
  const canAdvance = step === 0 ? titleValid : step === 1 ? labelsValid : wagerValid;

  function updateOption(index: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  function addOption() {
    setOptions((prev) => (prev.length < MAX_OPTIONS ? [...prev, ""] : prev));
  }

  function removeOption(index: number) {
    setOptions((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== index) : prev));
    if (creatorSide === "b" && index === options.length - 1) setCreatorSide("a");
  }

  function handleSubmit() {
    if (isTwoOption) {
      const formData = new FormData();
      formData.set("title", title.trim());
      if (description.trim()) formData.set("description", description.trim());
      formData.set("sideALabel", trimmedOptions[0]);
      formData.set("sideBLabel", trimmedOptions[1]);
      if (minWager) formData.set("minWager", minWager);
      if (maxWager) formData.set("maxWager", maxWager);
      if (deadline) formData.set("deadline", deadline);
      if (wagerNow && Number(creatorAmount) > 0) {
        formData.set("creatorSide", creatorSide);
        formData.set("creatorAmount", creatorAmount);
      }

      startTransition(async () => {
        // On success this redirects, so only the failure path returns here.
        const result = await createBet(formData);
        if (result?.error) {
          toast.error(result.error);
          setStep(0);
        }
      });
      return;
    }

    const formData = new FormData();
    formData.set("title", title.trim());
    if (description.trim()) formData.set("description", description.trim());
    trimmedOptions.forEach((label) => formData.append("optionLabels", label));
    if (minWager) formData.set("minWager", minWager);
    if (maxWager) formData.set("maxWager", maxWager);
    if (deadline) formData.set("deadline", deadline);

    startTransition(async () => {
      const result = await createBetWithOptions(formData);
      if (result?.error) {
        toast.error(result.error);
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
              Name two or more options. Everyone picks one and stakes into the pool.
            </p>
          </div>

          <div className="space-y-2">
            {options.map((option, i) => (
              <div key={i} className="flex items-center gap-2">
                <Label htmlFor={`option-${i}`} className="sr-only">
                  Option {i + 1}
                </Label>
                <Input
                  id={`option-${i}`}
                  value={option}
                  onChange={(e) => updateOption(i, e.target.value)}
                  placeholder={i === 0 ? "Yes" : i === 1 ? "No" : `Option ${i + 1}`}
                  maxLength={50}
                />
                {options.length > 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeOption(i)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove option ${i + 1}`}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {trimmedOptions.length !== new Set(trimmedOptions.map((o) => o.toLowerCase())).size && (
              <p className="text-xs text-destructive">Option names must be unique.</p>
            )}
          </div>

          {options.length < MAX_OPTIONS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addOption}
              className="font-bold"
            >
              <Plus className="size-3.5" />
              Add option
            </Button>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-black">Set the rules</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isTwoOption
                ? "Optionally cap the stakes, set a deadline, and wager now."
                : "Optionally cap the stakes and set a deadline."}
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

          {/* Wagering now on creation only exists for the 2-option path
              (createBet's creatorSide/creatorAmount fields). A 3+-option
              bet's creator wagers as a normal follow-up step on the bet's
              own page instead, same as anyone else. */}
          {isTwoOption && (
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
                      {trimmedOptions[0] || "Side A"}
                    </Button>
                    <Button
                      type="button"
                      variant={creatorSide === "b" ? "default" : "outline"}
                      onClick={() => setCreatorSide("b")}
                    >
                      {trimmedOptions[1] || "Side B"}
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
          )}
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
            <div className="flex items-start justify-between gap-4 p-3">
              <dt className="text-muted-foreground shrink-0">Options</dt>
              <dd className="font-medium text-right">
                {isTwoOption ? (
                  <>
                    <span className="text-emerald-400">{trimmedOptions[0]}</span>
                    {" / "}
                    <span className="text-rose-400">{trimmedOptions[1]}</span>
                  </>
                ) : (
                  trimmedOptions.join(" · ")
                )}
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
            {isTwoOption && (
              <div className="flex items-center justify-between gap-4 p-3">
                <dt className="text-muted-foreground">Your wager</dt>
                <dd className="font-medium">
                  {wagerNow && Number(creatorAmount) > 0
                    ? `${formatCurrency(Number(creatorAmount))} on ${
                        creatorSide === "a" ? trimmedOptions[0] : trimmedOptions[1]
                      }`
                    : "None"}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

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
