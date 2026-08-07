import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { BetStatusBadge } from "@/components/bet/BetStatusBadge";
import { CountdownTimer } from "@/components/bet/CountdownTimer";
import { getBestPrices, getPosition, formatCents } from "@/lib/utils/marketBook";
import type { MarketWithBook } from "@/lib/types";

interface MarketCardProps {
  market: MarketWithBook;
  currentUserId: string;
}

export function MarketCard({ market, currentUserId }: MarketCardProps) {
  const best = getBestPrices(market.market_orders);
  const position = getPosition(market.market_fills, currentUserId);
  const volume = market.market_fills.reduce((sum, f) => sum + f.quantity, 0);

  return (
    <Link href={`/markets/${market.id}`}>
      <Card className="hover:border-primary/40 transition-colors cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm leading-snug truncate">{market.title}</p>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span>
                  <span className="text-emerald-400 font-medium">
                    {market.yes_label} {best.yes ? formatCents(best.yes.price) : "—"}
                  </span>
                  {" · "}
                  <span className="text-rose-400 font-medium">
                    {market.no_label} {best.no ? formatCents(best.no.price) : "—"}
                  </span>
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {position.hasPosition ? (
                  <span className="text-primary font-medium">
                    You hold {position.yes > 0 && `${position.yes} ${market.yes_label}`}
                    {position.yes > 0 && position.no > 0 && " · "}
                    {position.no > 0 && `${position.no} ${market.no_label}`}
                  </span>
                ) : volume > 0 ? (
                  `${volume} traded`
                ) : (
                  <span className="text-primary">No trades yet</span>
                )}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <BetStatusBadge status={market.status} />
              <span className="text-xl font-black text-primary">
                {market.last_price != null ? formatCents(market.last_price) : "—"}
              </span>
              {market.deadline &&
                market.status !== "resolved" &&
                market.status !== "cancelled" && <CountdownTimer deadline={market.deadline} />}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
