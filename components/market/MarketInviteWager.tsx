"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { placeMarketOrder } from "@/lib/actions/markets";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import {
  CONTRACT_CENTS,
  centsToDollars,
  formatCents,
  getBestPrices,
  previewFill,
} from "@/lib/utils/marketBook";
import { savePendingWager, readPendingWager, clearPendingWager } from "@/lib/utils/pendingWager";
import { SideChoice, type SideChoiceOption } from "@/components/bet/SideChoice";
import type { MarketOrder, MarketSide } from "@/lib/types";

interface MarketInviteWagerProps {
  inviteCode: string;
  isSignedIn: boolean;
  yesLabel: string;
  noLabel: string;
  /** Two entries, id "yes"/"no" -- who holds a filled position on each side and how much they've put up. */
  options: SideChoiceOption[];
  /** The resting book, for the live fill preview. Already loaded by the page -- no new network calls. */
  orders: MarketOrder[];
  maxContracts: number | null;
  /** Null once the deadline has already passed at render time -- this component doesn't get mounted for that case, but it can still happen live (see below). */
  deadline: string | null;
  /** 'iou' | 'usdc' -- markets.backing, immutable at creation. Drives every payout/disclosure line here. */
  backing: string;
}

function hasPassed(deadline: string | null): boolean {
  return deadline != null && new Date(deadline).getTime() <= Date.now();
}

export function MarketInviteWager({
  inviteCode,
  isSignedIn,
  yesLabel,
  noLabel,
  options,
  orders,
  maxContracts,
  deadline,
  backing,
}: MarketInviteWagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [side, setSide] = useState<MarketSide | null>(null);
  const [price, setPrice] = useState(50);
  const [quantity, setQuantity] = useState(10);
  const [mode, setMode] = useState<"choose" | "confirm">("choose");

  // The countdown reaching zero must change what this page lets you do, not
  // just what CountdownTimer displays -- mirrors BetInviteWager's identical
  // guard, on an interval rather than a single setTimeout because a
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
  // signed in -- see BetInviteWager's identical comment for why.
  useEffect(() => {
    if (!isSignedIn) return;
    const pending = readPendingWager("market", inviteCode);
    if (!pending || pending.kind !== "market") return;

    setSide(pending.side);
    setPrice(pending.limitPrice);
    setQuantity(pending.quantity);
    setMode("confirm");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  if (deadlinePassed) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        The deadline passed while this page was open -- this market is no longer accepting orders.
      </p>
    );
  }

  const label = side === "yes" ? yesLabel : side === "no" ? noLabel : "";
  const best = useMemo(() => getBestPrices(orders), [orders]);
  const bestForSide = side === "yes" ? best.yes : side === "no" ? best.no : null;
  const preview = useMemo(
    () => (side ? previewFill(orders, "", side, price, quantity) : null),
    [orders, side, price, quantity]
  );

  const riskCents = price * quantity;
  const winCents = (CONTRACT_CENTS - price) * quantity;
  const isValidQuantity =
    Number.isInteger(quantity) && quantity > 0 && (maxContracts == null || quantity <= maxContracts);

  function submitOrder(s: MarketSide, p: number, q: number) {
    startTransition(async () => {
      try {
        const result = await placeMarketOrder({ inviteCode }, s, p, q);
        if (result?.error) {
          toast.error(result.error);
          return;
        }
        // Belt-and-suspenders: placeMarketOrder always redirect()s on
        // success from an invite link (see below), so this line is
        // normally unreachable.
        clearPendingWager("market", inviteCode);
      } catch (err) {
        // redirect() throws to hand control to Next's router -- that IS the
        // success path here (see BetInviteWager's identical comment), so
        // this catch is where "clear on success" actually happens.
        clearPendingWager("market", inviteCode);
        unstable_rethrow(err);
        toast.error("Something went wrong placing your order. Please try again.");
      }
    });
  }

  function handleCommit() {
    if (!side || !isValidQuantity) return;

    if (!isSignedIn) {
      savePendingWager({
        kind: "market",
        inviteCode,
        side,
        limitPrice: price,
        quantity,
        savedAt: Date.now(),
      });
      router.push(`/login?redirect=${encodeURIComponent(`/market/${inviteCode}`)}`);
      return;
    }

    submitOrder(side, price, quantity);
  }

  function handleConfirmRestored() {
    if (!side || !isValidQuantity) return;
    submitOrder(side, price, quantity);
  }

  // Backing-conditional -- an IOU market must never sound like the app is
  // holding anything, and a USDC market can state escrow plainly because it
  // is real. Vocabulary matches CreateMarketForm's shipped copy.
  const disclosure =
    backing === "usdc" ? (
      <p className="text-xs text-muted-foreground">
        Every order here is backed by real funds held in escrow — your side is funded before it can trade.
      </p>
    ) : (
      <p className="text-xs text-muted-foreground">
        Over/Under doesn&apos;t hold your money on this market. If you&apos;re right, whoever&apos;s on the
        other side of your trade owes you — you settle up yourselves.
      </p>
    );

  if (mode === "confirm" && side) {
    return (
      <div className="space-y-4">
        <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Picking up where you left off
          </p>
          <div className="flex items-center justify-between">
            <span className="font-bold">
              {quantity} {label}
            </span>
            <span className="font-bold tabular-nums">{formatCents(price)}</span>
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Risk</span>
              <span className="font-bold tabular-nums">{formatCurrency(centsToDollars(riskCents))}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Win if {label}</span>
              <span className="font-bold text-win tabular-nums">
                +{formatCurrency(centsToDollars(winCents))}
              </span>
            </div>
          </div>
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
            {isPending ? "Placing order…" : `Confirm — buy ${quantity} ${label} at ${formatCents(price)}`}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SideChoice
        options={options}
        value={side}
        onChange={(id) => setSide(id as MarketSide)}
        groupLabel="Choose a side"
      />

      {/* aria-live announces the reveal to assistive tech; the container itself
          stays mounted across the state change so the announcement fires. */}
      <div aria-live="polite">
        {side && (
          <div className="space-y-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="order-price">Your price</Label>
                <span className="text-sm font-semibold text-primary tabular-nums">{formatCents(price)}</span>
              </div>
              <input
                id="order-price"
                type="range"
                min={1}
                max={99}
                step={1}
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <p className="text-xs text-muted-foreground">
                {bestForSide
                  ? `${formatCents(bestForSide.price)} available right now for ${label}.`
                  : "No offers on the book yet — this will rest until someone takes the other side."}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="order-quantity">
                Contracts
                {maxContracts != null && (
                  <span className="text-muted-foreground font-normal"> (max {maxContracts} per side)</span>
                )}
              </Label>
              <Input
                id="order-quantity"
                type="number"
                min={1}
                max={maxContracts ?? undefined}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              />
            </div>

            <div className="space-y-1 rounded-lg bg-secondary/50 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Risk</span>
                <span className="font-bold tabular-nums">{formatCurrency(centsToDollars(riskCents))}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Win if {label}</span>
                <span className="font-bold text-win tabular-nums">
                  +{formatCurrency(centsToDollars(winCents))}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {preview && preview.filled > 0
                  ? `${preview.filled} would fill now at ${formatCents(preview.avgPrice ?? price)}${
                      preview.resting > 0 ? `, ${preview.resting} would rest` : ""
                    }.`
                  : "Nothing to match yet — this would rest until someone takes the other side."}
              </p>
            </div>

            {disclosure}

            <Button
              type="button"
              className="w-full py-6 text-base font-semibold"
              disabled={!isValidQuantity || isPending}
              onClick={handleCommit}
            >
              {isPending
                ? "Placing order…"
                : isSignedIn
                  ? `Buy ${quantity} ${label} at ${formatCents(price)}`
                  : "Sign in to lock it in"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
