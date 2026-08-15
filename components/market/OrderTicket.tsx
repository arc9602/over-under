"use client";

import { useMemo, useState, useTransition } from "react";
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
  getPosition,
  otherSide,
  previewFill,
} from "@/lib/utils/marketBook";
import type { MarketFill, MarketOrder, MarketSide } from "@/lib/types";

interface OrderTicketProps {
  identifier: { marketId: string } | { inviteCode: string };
  currentUserId: string;
  yesLabel: string;
  noLabel: string;
  orders: MarketOrder[];
  fills: MarketFill[];
  maxContracts: number | null;
}

export function OrderTicket({
  identifier,
  currentUserId,
  yesLabel,
  noLabel,
  orders,
  fills,
  maxContracts,
}: OrderTicketProps) {
  const [isPending, startTransition] = useTransition();
  const [side, setSide] = useState<MarketSide>("yes");
  const [price, setPrice] = useState(50);
  const [quantity, setQuantity] = useState(10);

  const best = useMemo(() => getBestPrices(orders), [orders]);
  const position = useMemo(() => getPosition(fills, currentUserId), [fills, currentUserId]);

  const preview = useMemo(
    () => previewFill(orders, currentUserId, side, price, quantity),
    [orders, currentUserId, side, price, quantity]
  );

  const label = side === "yes" ? yesLabel : noLabel;
  const riskCents = price * quantity;
  const winCents = (CONTRACT_CENTS - price) * quantity;

  function applyCloseOut() {
    // Exiting is buying the opposite side: 10 YES + 10 NO is a flat book
    // whichever way this resolves. Prefill the ticket with exactly that.
    const closingSide = position.net > 0 ? "no" : "yes";
    setSide(closingSide);
    setQuantity(Math.abs(position.net));
    const bestForSide = closingSide === "yes" ? best.yes : best.no;
    if (bestForSide) setPrice(bestForSide.price);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await placeMarketOrder(identifier, side, price, quantity);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      if (result?.success) {
        if (result.filled > 0) {
          toast.success(`Filled ${result.filled} at ${formatCents(result.avgPrice ?? price)}`, {
            description:
              result.resting > 0 ? `${result.resting} resting on the book` : undefined,
          });
        } else {
          toast.info(`${result.resting} contracts resting on the book`, {
            description: "No match yet — someone has to take the other side.",
          });
        }
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(["yes", "no"] as const).map((s) => {
          const bestForSide = s === "yes" ? best.yes : best.no;
          return (
            <Button
              key={s}
              type="button"
              variant={side === s ? "default" : "outline"}
              className="h-auto py-3 flex-col gap-0.5"
              onClick={() => setSide(s)}
            >
              <span className="font-bold truncate max-w-full">{s === "yes" ? yesLabel : noLabel}</span>
              <span className="text-[10px] opacity-70">
                {bestForSide ? `${formatCents(bestForSide.price)} available` : "no offers"}
              </span>
            </Button>
          );
        })}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="price">Your price</Label>
          <span className="text-sm font-semibold text-primary tabular-nums">{formatCents(price)}</span>
        </div>
        <input
          id="price"
          type="range"
          min={1}
          max={99}
          step={1}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          className="w-full accent-primary"
        />
        <p className="text-xs text-muted-foreground">
          The most you&apos;ll pay per contract. You may get filled cheaper — a resting order
          always trades at its own price.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="quantity">
          Contracts
          {maxContracts != null && (
            <span className="text-muted-foreground font-normal"> (max {maxContracts} per side)</span>
          )}
        </Label>
        <Input
          id="quantity"
          name="quantity"
          type="number"
          min={1}
          max={maxContracts ?? undefined}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          required
        />
      </div>

      <div className="rounded-lg border border-border p-3 space-y-1.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Risk</span>
          <span className="font-bold tabular-nums">{formatCurrency(centsToDollars(riskCents))}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Win if {label}</span>
          <span className="font-bold text-win tabular-nums">
            +{formatCurrency(centsToDollars(winCents))}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Breakeven</span>
          <span className="tabular-nums">{price}% likely</span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-1.5">
          <span className="text-muted-foreground">Right now</span>
          <span className="text-xs text-right">
            {preview.filled > 0 ? (
              <>
                <span className="font-bold text-foreground">
                  {preview.filled} fills at {formatCents(preview.avgPrice ?? price)}
                </span>
                {preview.resting > 0 && (
                  <span className="text-muted-foreground">, {preview.resting} rests</span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">nothing to match — it&apos;ll rest</span>
            )}
          </span>
        </div>
      </div>

      {position.net !== 0 && (
        <button
          type="button"
          onClick={applyCloseOut}
          className="text-xs text-primary hover:underline"
        >
          Close my position — buy {Math.abs(position.net)}{" "}
          {position.net > 0 ? noLabel : yesLabel} to offset
        </button>
      )}

      <Button type="submit" className="w-full font-semibold text-base py-6" disabled={isPending}>
        {isPending
          ? "Placing order…"
          : `Buy ${quantity} ${label} at ${formatCents(price)}`}
      </Button>

      <p className="text-[11px] text-muted-foreground text-center">
        No sell button: to get out, buy {otherSide(side) === "yes" ? yesLabel : noLabel}. The two
        positions cancel and your result is locked in.
      </p>
    </form>
  );
}
