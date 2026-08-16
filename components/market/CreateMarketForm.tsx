"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Stepper } from "@/components/shared/Stepper";
import { createMarket } from "@/lib/actions/markets";
import { isUsdcEnabled } from "@/lib/chain/env";
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
  const [step, setStep] = useState(0);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [yesLabel, setYesLabel] = useState("Yes");
  const [noLabel, setNoLabel] = useState("No");
  const [maxContracts, setMaxContracts] = useState("");
  const [deadline, setDeadline] = useState("");
  const [backing, setBacking] = useState<"iou" | "usdc">("iou");
  const [seedBook, setSeedBook] = useState(false);
  const [openingSide, setOpeningSide] = useState<"yes" | "no">("yes");
  const [openingPrice, setOpeningPrice] = useState(50);
  const [openingQuantity, setOpeningQuantity] = useState(10);

  const titleValid = title.trim().length >= 3;
  const labelsValid = yesLabel.trim().length > 0 && noLabel.trim().length > 0;
  const canAdvance = step === 0 ? titleValid : step === 1 ? labelsValid : true;

  function handleSubmit() {
    const formData = new FormData();
    formData.set("title", title.trim());
    if (description.trim()) formData.set("description", description.trim());
    formData.set("yesLabel", yesLabel.trim());
    formData.set("noLabel", noLabel.trim());
    if (maxContracts) formData.set("maxContracts", maxContracts);
    if (deadline) formData.set("deadline", deadline);
    // Omitted entirely while USDC is off -- createMarket defaults an absent
    // value to 'iou' via createMarketSchema, and this control isn't rendered
    // below for the user to have chosen anything else.
    if (isUsdcEnabled()) formData.set("backing", backing);
    if (seedBook) {
      formData.set("openingSide", openingSide);
      formData.set("openingPrice", String(openingPrice));
      formData.set("openingQuantity", String(openingQuantity));
    }

    startTransition(async () => {
      // On success this redirects, so only the failure path returns here.
      const result = await createMarket(formData);
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
            <h2 className="text-xl font-bold">What&apos;s the question?</h2>
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

          {/* Absent, not disabled, while USDC is off: a greyed-out radio still
              advertises that custody exists on this deployment, which is the
              exact confirmation the server-side 404s in the wallet and bets
              routes are built to withhold. See lib/chain/env.ts. */}
          {isUsdcEnabled() && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">How is this market backed?</p>

              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="backing"
                  value="iou"
                  checked={backing === "iou"}
                  onChange={() => setBacking("iou")}
                  className="accent-primary mt-0.5"
                />
                <span>
                  <span className="font-medium">IOU</span>
                  <span className="block text-xs text-muted-foreground">
                    Track who owes what, no deposit needed.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="backing"
                  value="usdc"
                  checked={backing === "usdc"}
                  onChange={() => setBacking("usdc")}
                  className="accent-primary mt-0.5"
                />
                <span>
                  <span className="font-medium">USDC</span>
                  <span className="block text-xs text-muted-foreground">
                    Every order is backed by real funds held in escrow.
                  </span>
                </span>
              </label>

              <p className="text-xs text-muted-foreground">
                This can&apos;t be changed once the market is created.
              </p>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold">What are the outcomes?</h2>
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
            <h2 className="text-xl font-bold">When does it settle?</h2>
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
                    <span className="text-sm font-semibold text-primary tabular-nums">
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
            <h2 className="text-xl font-bold">Ready to open?</h2>
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
                <span className="text-win">{yesLabel.trim()}</span>
                {" / "}
                <span className="text-loss">{noLabel.trim()}</span>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Max per side</dt>
              <dd className="font-medium">{maxContracts || "No limit"}</dd>
            </div>
            {/* Only worth reviewing when it was a decision. With USDC parked
                there is no control at step 0 that produces anything but IOU,
                so a "Backing: IOU" line here reads as a setting the user
                chose and might change -- it is neither. */}
            {isUsdcEnabled() && (
              <div className="flex items-center justify-between gap-4 p-3">
                <dt className="text-muted-foreground">Backing</dt>
                <dd className="font-medium">{backing === "usdc" ? "USDC (escrowed)" : "IOU"}</dd>
              </div>
            )}
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
            className="font-semibold ml-auto"
          >
            {isPending ? "Creating…" : "Create Market & Get Link"}
          </Button>
        )}
      </div>
    </div>
  );
}
