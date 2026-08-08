"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Stepper } from "@/components/shared/Stepper";
import { createMarket } from "@/lib/actions/markets";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { CONTRACT_CENTS, centsToDollars, formatCents } from "@/lib/utils/marketBook";

/**
 * Four-step market builder. All fields live in component state rather than
 * an uncontrolled <form>, because inputs on hidden steps would otherwise
 * unmount and lose their values before submit. The server action still
 * receives the same FormData keys it always has -- createMarket is
 * untouched.
 */

const STEPS = ["Details", "Outcomes", "Resolution", "Review"];

export function CreateMarketForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [yesLabel, setYesLabel] = useState("Yes");
  const [noLabel, setNoLabel] = useState("No");
  const [maxContracts, setMaxContracts] = useState("");
  const [deadline, setDeadline] = useState("");
  const [seedBook, setSeedBook] = useState(false);
  const [openingSide, setOpeningSide] = useState<"yes" | "no">("yes");
  const [openingPrice, setOpeningPrice] = useState(50);
  const [openingQuantity, setOpeningQuantity] = useState(10);

  const titleValid = title.trim().length >= 3;
  const labelsValid = yesLabel.trim().length > 0 && noLabel.trim().length > 0;
  const canAdvance = step === 0 ? titleValid : step === 1 ? labelsValid : true;

  function handleSubmit() {
    setError(null);
    const formData = new FormData();
    formData.set("title", title.trim());
    if (description.trim()) formData.set("description", description.trim());
    formData.set("yesLabel", yesLabel.trim());
    formData.set("noLabel", noLabel.trim());
    if (maxContracts) formData.set("maxContracts", maxContracts);
    if (deadline) formData.set("deadline", deadline);
    if (seedBook) {
      formData.set("openingSide", openingSide);
      formData.set("openingPrice", String(openingPrice));
      formData.set("openingQuantity", String(openingQuantity));
    }

    startTransition(async () => {
      const result = await createMarket(formData);
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
            <h2 className="text-xl font-black">What&apos;s the question?</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Define the event clearly to avoid disputes later.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Market title</Label>
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
              placeholder="Add any relevant context or rules for this specific market…"
              maxLength={500}
              rows={3}
            />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-black">What are the outcomes?</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Name both sides. Traders buy one or the other.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="yesLabel">Yes side</Label>
              <Input
                id="yesLabel"
                value={yesLabel}
                onChange={(e) => setYesLabel(e.target.value)}
                placeholder="Yes"
                maxLength={50}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="noLabel">No side</Label>
              <Input
                id="noLabel"
                value={noLabel}
                onChange={(e) => setNoLabel(e.target.value)}
                placeholder="No"
                maxLength={50}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxContracts">
              Max contracts per side{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="maxContracts"
              type="number"
              value={maxContracts}
              onChange={(e) => setMaxContracts(e.target.value)}
              placeholder="No limit"
              min="1"
              step="1"
            />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-black">When does it settle?</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Optionally set a deadline and post the first order.
            </p>
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
                    type="number"
                    min="1"
                    step="1"
                    value={openingQuantity}
                    onChange={(e) =>
                      setOpeningQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                    }
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Risks {formatCurrency(centsToDollars(openingPrice * openingQuantity))} to win{" "}
                  {formatCurrency(centsToDollars((CONTRACT_CENTS - openingPrice) * openingQuantity))}.
                </p>
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
              <dt className="text-muted-foreground shrink-0">Question</dt>
              <dd className="font-medium text-right">{title.trim() || "—"}</dd>
            </div>
            {description.trim() && (
              <div className="flex items-start justify-between gap-4 p-3">
                <dt className="text-muted-foreground shrink-0">Description</dt>
                <dd className="text-right text-muted-foreground">{description.trim()}</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Outcomes</dt>
              <dd className="font-medium">
                <span className="text-emerald-400">{yesLabel.trim()}</span>
                {" / "}
                <span className="text-rose-400">{noLabel.trim()}</span>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Max per side</dt>
              <dd className="font-medium">{maxContracts || "No limit"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Deadline</dt>
              <dd className="font-medium">
                {deadline ? new Date(deadline).toLocaleString() : "None"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Opening order</dt>
              <dd className="font-medium">
                {seedBook
                  ? `${openingQuantity} ${openingSide === "yes" ? yesLabel : noLabel} at ${formatCents(openingPrice)}`
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
            disabled={isPending || !titleValid || !labelsValid}
            className="font-black ml-auto"
          >
            {isPending ? "Creating…" : "Create Market & Get Link"}
          </Button>
        )}
      </div>
    </div>
  );
}
