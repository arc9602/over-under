"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { placeWager, placeOptionWager } from "@/lib/actions/bets";
import { getPredictedPayout } from "@/lib/utils/betPool";
import { formatStake } from "@/lib/utils/formatStake";
import { savePendingWager, readPendingWager, clearPendingWager } from "@/lib/utils/pendingWager";
import { SideChoice, type SideChoiceOption } from "./SideChoice";

interface BetInviteWagerProps {
  inviteCode: string;
  isSignedIn: boolean;
  /** True for the legacy 2-option shape (side "a"/"b"), false for 3+ options (option_id). */
  isTwoOption: boolean;
  /** Sorted by sort_order -- for a 2-option bet, options[0] is side "a" and options[1] is side "b" (guaranteed by the bet_options backfill trigger, see betPool.ts). */
  options: SideChoiceOption[];
  minWager: number | null;
  maxWager: number | null;
  /** Null once the deadline has already passed at render time -- this component doesn't get mounted for that case, but it can still happen live (see below). */
  deadline: string | null;
  creatorName: string;
  /** What the stake is denominated in -- 'USD' is money (migration 022). */
  unit: string;
  unitPlural: string | null;
}

function hasPassed(deadline: string | null): boolean {
  return deadline != null && new Date(deadline).getTime() <= Date.now();
}

export function BetInviteWager({
  inviteCode,
  isSignedIn,
  isTwoOption,
  options,
  minWager,
  maxWager,
  deadline,
  creatorName,
  unit,
  unitPlural,
}: BetInviteWagerProps) {
  // Amounts here are in the bet's own stake unit, not necessarily dollars.
  const stake = (amount: number) =>
    formatStake(amount, unit, unitPlural);

  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [mode, setMode] = useState<"choose" | "confirm">("choose");

  // The countdown reaching zero must change what this page lets you do, not
  // just what CountdownTimer displays -- so this re-checks independently of
  // that component, on an interval rather than a single setTimeout because a
  // backgrounded tab can sleep past a one-shot timer.
  const [deadlinePassed, setDeadlinePassed] = useState(() => hasPassed(deadline));
  useEffect(() => {
    if (deadlinePassed || deadline == null) return;
    const interval = setInterval(() => {
      if (hasPassed(deadline)) setDeadlinePassed(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [deadline, deadlinePassed]);

  // Restore intent saved before an OAuth redirect. Runs once, only once
  // signed in -- a pending entry left over from an abandoned sign-in attempt
  // shouldn't produce a confirm screen for someone who still isn't
  // authenticated, since placeWager/placeOptionWager would just bounce them
  // back to /login anyway.
  useEffect(() => {
    if (!isSignedIn) return;
    const pending = readPendingWager("bet", inviteCode);
    // readPendingWager's return type isn't narrowed by the "bet" literal
    // passed in above (its signature is the plan's fixed shape, not an
    // overload), so this is the runtime check that stands in for it.
    if (!pending || pending.kind !== "bet") return;

    const optionId =
      pending.optionId ?? (pending.side === "a" ? options[0]?.id : pending.side === "b" ? options[1]?.id : null);
    if (!optionId) return;

    setSelectedOptionId(optionId);
    setAmountInput(String(pending.amount));
    setMode("confirm");
    // Deliberately not dependent on inviteCode/options -- this page never
    // changes invite code under the same mounted component, and re-running
    // this on every options identity change would re-open the confirm step
    // after the user had already dismissed it via "Change".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  if (deadlinePassed) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        The deadline passed while this page was open -- this bet is no longer accepting wagers.
      </p>
    );
  }

  const selectedOption = options.find((o) => o.id === selectedOptionId) ?? null;
  const parsedAmount = Number(amountInput);
  const isValidAmount =
    amountInput.trim() !== "" &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    (minWager == null || parsedAmount >= minWager) &&
    (maxWager == null || parsedAmount <= maxWager);

  const mySideTotal = selectedOption?.total ?? 0;
  const otherSideTotal = options.filter((o) => o.id !== selectedOptionId).reduce((sum, o) => sum + o.total, 0);
  const preview =
    selectedOptionId && isValidAmount ? getPredictedPayout(mySideTotal, otherSideTotal, 0, parsedAmount) : null;

  const limitsText = [
    minWager != null ? `min ${stake(minWager)}` : null,
    maxWager != null ? `max ${stake(maxWager)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // options[0] is side "a" and options[1] is side "b" for every 2-option bet
  // -- the create_legacy_bet_options trigger backfills bet_options 0/1 from
  // side_a_label/side_b_label for every bet, so this holds regardless of how
  // old the bet is. Only ever called when isTwoOption is true.
  function sideForOption(optionId: string): "a" | "b" {
    return options.findIndex((o) => o.id === optionId) === 0 ? "a" : "b";
  }

  function submitWager(optionId: string, amount: number) {
    startTransition(async () => {
      try {
        const result = isTwoOption
          ? await placeWager({ inviteCode }, sideForOption(optionId), amount)
          : await placeOptionWager({ inviteCode }, optionId, amount);
        if (result?.error) {
          toast.error(result.error);
          return;
        }
        // Belt-and-suspenders: placeWager/placeOptionWager always redirect()
        // on success (see below), so this line is normally unreachable.
        clearPendingWager("bet", inviteCode);
      } catch (err) {
        // redirect() throws to hand control to Next's router -- that IS the
        // success path here (see WagerForm's identical comment), so this
        // catch, not the line after a successful await, is where "clear on
        // success" actually happens. Clear first, then let unstable_rethrow
        // sort it out: it rethrows Next's own redirect/notFound control-flow
        // errors so navigation still proceeds, and returns quietly for any
        // other error so a real failure surfaces as a toast instead of a
        // blank screen.
        clearPendingWager("bet", inviteCode);
        unstable_rethrow(err);
        toast.error("Something went wrong placing your wager. Please try again.");
      }
    });
  }

  function handleCommit() {
    if (!selectedOptionId || !isValidAmount) return;

    if (!isSignedIn) {
      savePendingWager({
        kind: "bet",
        inviteCode,
        side: isTwoOption ? sideForOption(selectedOptionId) : null,
        optionId: isTwoOption ? null : selectedOptionId,
        amount: parsedAmount,
        savedAt: Date.now(),
      });
      router.push(`/login?redirect=${encodeURIComponent(`/bet/${inviteCode}`)}`);
      return;
    }

    submitWager(selectedOptionId, parsedAmount);
  }

  function handleConfirmRestored() {
    if (!selectedOptionId || !isValidAmount) return;
    submitWager(selectedOptionId, parsedAmount);
  }

  const disclosure = (
    <p className="text-xs text-muted-foreground">
      Over/Under doesn&apos;t hold your money. This records what you owe — you and {creatorName} settle up
      yourselves.
    </p>
  );

  if (mode === "confirm" && selectedOption) {
    return (
      <div className="space-y-4">
        <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Picking up where you left off
          </p>
          <div className="flex items-center justify-between">
            <span className="font-bold">{selectedOption.label}</span>
            <span className="font-bold tabular-nums">{stake(parsedAmount)}</span>
          </div>
          {preview && (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Projected return</span>
                <span className="font-bold tabular-nums">{stake(preview.payout)}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">Moves as others join.</p>
            </div>
          )}
        </div>

        {disclosure}

        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => setMode("choose")}>
            Change
          </Button>
          <Button
            type="button"
            className="flex-[2] font-semibold"
            disabled={isPending}
            onClick={handleConfirmRestored}
          >
            {isPending ? "Placing wager…" : `Confirm — put ${stake(parsedAmount)} on ${selectedOption.label}`}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SideChoice
        unit={unit}
        unitPlural={unitPlural}
        options={options}
        value={selectedOptionId}
        onChange={setSelectedOptionId}
        groupLabel="Choose a side"
      />

      {/* aria-live announces the reveal to assistive tech; the container itself
          stays mounted across the state change so the announcement fires. */}
      <div aria-live="polite">
        {selectedOptionId && selectedOption && (
          <div className="space-y-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1">
            <div className="space-y-2">
              <Label htmlFor="stake-amount">Your wager{limitsText ? ` (${limitsText})` : ""}</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-muted-foreground">$</span>
                <Input
                  id="stake-amount"
                  type="number"
                  placeholder="20.00"
                  min={0.01}
                  max={maxWager ?? undefined}
                  step="0.01"
                  className="pl-6"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                />
              </div>
            </div>

            {preview && (
              <div className="space-y-1 rounded-lg bg-secondary/50 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Projected return if {selectedOption.label} wins</span>
                  <span className="font-bold tabular-nums">{stake(preview.payout)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Moves as others join.</p>
              </div>
            )}

            {disclosure}

            <Button
              type="button"
              className="w-full py-6 text-base font-semibold"
              disabled={!isValidAmount || isPending}
              onClick={handleCommit}
            >
              {isPending
                ? "Placing wager…"
                : isSignedIn
                  ? `Put ${stake(isValidAmount ? parsedAmount : 0)} on ${selectedOption.label}`
                  : "Sign in to lock it in"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
