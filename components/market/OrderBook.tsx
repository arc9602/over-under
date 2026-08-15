import { Card, CardContent } from "@/components/ui/card";
import { getBookLevels, getBestPrices, formatCents } from "@/lib/utils/marketBook";
import type { MarketOrder, MarketSide } from "@/lib/types";

interface OrderBookProps {
  orders: MarketOrder[];
  yesLabel: string;
  noLabel: string;
}

function BookSide({
  label,
  side,
  orders,
  accent,
}: {
  label: string;
  side: MarketSide;
  orders: MarketOrder[];
  accent: string;
}) {
  const levels = getBookLevels(orders, side).slice(0, 5);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase truncate">
          {label}
        </p>
        <p className="text-[10px] text-muted-foreground">bids</p>
      </div>
      {levels.length === 0 ? (
        <p className="text-xs text-muted-foreground py-1">No orders yet</p>
      ) : (
        <ul className="space-y-1">
          {levels.map((level) => (
            <li key={level.price} className="flex items-center justify-between text-xs">
              <span className={`font-bold ${accent}`}>{formatCents(level.price)}</span>
              <span className="text-muted-foreground">
                {level.quantity} {level.quantity === 1 ? "contract" : "contracts"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OrderBook({ orders, yesLabel, noLabel }: OrderBookProps) {
  const best = getBestPrices(orders);
  const isEmpty =
    getBookLevels(orders, "yes").length === 0 && getBookLevels(orders, "no").length === 0;

  // A brand-new market would otherwise stack four separate "nothing here"
  // messages (two price tiles + two depth columns). Say it once instead.
  if (isEmpty) {
    return (
      <Card>
        <CardContent className="p-4 py-8 text-center space-y-1">
          <p className="text-sm font-bold">The book is empty</p>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            No one has posted an order yet. Post the first one and it&apos;ll rest here until
            someone takes the other side.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {/* There is no separate ask side: buying YES means matching a
              resting NO bid, so the cheapest YES available is 100c minus the
              best NO bid. */}
          <div className="rounded bg-secondary p-2.5 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5 truncate">
              Buy {yesLabel}
            </p>
            <p className="text-xl font-black text-win">
              {best.yes ? formatCents(best.yes.price) : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {best.yes ? `${best.yes.quantity} available` : "no sellers"}
            </p>
          </div>
          <div className="rounded bg-secondary p-2.5 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5 truncate">
              Buy {noLabel}
            </p>
            <p className="text-xl font-black text-loss">
              {best.no ? formatCents(best.no.price) : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {best.no ? `${best.no.quantity} available` : "no sellers"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-border pt-3">
          <BookSide label={yesLabel} side="yes" orders={orders} accent="text-win" />
          <BookSide label={noLabel} side="no" orders={orders} accent="text-loss" />
        </div>
      </CardContent>
    </Card>
  );
}
