"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  applySimplification,
  previewSimplification,
  type PreviewSimplificationResult,
} from "@/lib/actions/simplifyDebts";
import { formatCurrency } from "@/lib/utils/formatCurrency";

/**
 * Two states, not one. previewSimplification is a whole-application graph
 * scan (see the privacy note atop lib/actions/simplifyDebts.ts) -- it used to
 * run on every /balances render regardless of whether anyone cared, and now
 * only runs when this card's own click asks for it. Until then there's
 * nothing to hide behind a loading skeleton: the quiet "Check for loops"
 * affordance below is the entire idle state, deliberately low-key so it
 * doesn't read as "something's wrong with your balances."
 */
type PreviewSuccess = Exclude<PreviewSimplificationResult, { error: string }>;

export function SimplifyDebtsCard() {
  const [preview, setPreview] = useState<PreviewSuccess | null>(null);
  const [isChecking, startCheck] = useTransition();
  const [isApplying, startApply] = useTransition();

  function handleCheck() {
    startCheck(async () => {
      const result = await previewSimplification();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setPreview(result);
    });
  }

  function handleApply() {
    startApply(async () => {
      const result = await applySimplification();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Cancelled ${result.paymentsRemoved} payment${result.paymentsRemoved === 1 ? "" : "s"}`,
        {
          description:
            result.centsCancelledForYou > 0
              ? `${formatCurrency(result.centsCancelledForYou / 100)} of it was yours.`
              : "None of it was yours, but it's one less payment for everyone else too.",
        }
      );
      // The loop this preview described no longer exists -- back to idle
      // rather than showing a stale plan that would just re-apply on click.
      setPreview(null);
    });
  }

  if (!preview) {
    return (
      <button
        type="button"
        onClick={handleCheck}
        disabled={isChecking}
        className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline disabled:opacity-50"
      >
        {isChecking ? "Checking…" : "Check for loops"}
      </button>
    );
  }

  if (preview.paymentsRemoved <= 0) {
    return <p className="text-xs text-muted-foreground">Nothing to simplify</p>;
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Tidy up
          </p>
          {/* Plain and specific about the mechanism, because the user is
              about to let the app rewrite their debts: some of these IOUs
              loop back around, cancelling the loop removes payments that
              never needed to happen, and nobody's actual balance moves. */}
          <p className="text-sm">
            Some of these debts loop back on themselves — you owe someone who
            owes someone who, eventually, owes you. Cancelling the loop
            removes {preview.paymentsRemoved} payment
            {preview.paymentsRemoved === 1 ? "" : "s"} that don&rsquo;t need to
            happen. Your net position doesn&rsquo;t change at all, and
            you&rsquo;ll never end up owing someone you didn&rsquo;t already
            have a bet with.
          </p>
        </div>

        {preview.yourDebtsAffected > 0 && (
          <div className="flex items-center justify-between border-t border-border pt-3">
            <p className="text-sm text-muted-foreground">Clears for you</p>
            <p className="text-sm font-semibold tabular-nums">
              {formatCurrency(preview.centsCancelledForYou / 100)}
            </p>
          </div>
        )}

        <Button
          onClick={handleApply}
          disabled={isApplying}
          size="sm"
          variant="outline"
          className="w-full font-bold text-xs"
        >
          {isApplying ? "Cancelling…" : "Cancel the loop"}
        </Button>
      </CardContent>
    </Card>
  );
}
