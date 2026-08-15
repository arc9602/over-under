import Link from "next/link";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SplitBar } from "@/components/shared/SplitBar";
import { BetStatusBadge } from "@/components/bet/BetStatusBadge";
import { CountdownTimer } from "@/components/bet/CountdownTimer";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getPosition, centsToDollars, CONTRACT_CENTS } from "@/lib/utils/marketBook";
import type { MarketWithBook } from "@/lib/types";

interface MarketCardProps {
  market: MarketWithBook;
  currentUserId: string;
}

export function MarketCard({ market, currentUserId }: MarketCardProps) {
  const position = getPosition(market.market_fills, currentUserId);
  const volume = market.market_fills.reduce((sum, f) => sum + f.quantity, 0);
  const markPrice = market.last_price ?? 50;
  const favorsYes = markPrice >= 50;
  const valueCents = position.yes * markPrice + position.no * (CONTRACT_CENTS - markPrice);

  return (
    <Link href={`/markets/${market.id}`}>
      <Card className="hover:border-primary/40 transition-colors cursor-pointer">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <BetStatusBadge status={market.status} />
            {market.last_price != null && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide shrink-0",
                  favorsYes ? "text-win" : "text-loss"
                )}
              >
                {favorsYes ? (
                  <TrendingUp className="size-3" />
                ) : (
                  <TrendingDown className="size-3" />
                )}
                {favorsYes ? market.yes_label : market.no_label}{" "}
                {Math.round(favorsYes ? markPrice : CONTRACT_CENTS - markPrice)}%
              </span>
            )}
          </div>

          <p className="font-bold text-sm leading-snug line-clamp-2">{market.title}</p>

          {position.hasPosition ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Stake</p>
                <p className="text-sm font-semibold tabular-nums">
                  {formatCurrency(centsToDollars(position.costCents))}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Current Value
                </p>
                <p
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    valueCents >= position.costCents ? "text-win" : "text-loss"
                  )}
                >
                  {formatCurrency(centsToDollars(valueCents))}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {volume > 0 ? `${volume} contracts traded` : "No trades yet"}
            </p>
          )}

          <SplitBar leftValue={markPrice} rightValue={CONTRACT_CENTS - markPrice} />

          {market.deadline &&
            market.status !== "resolved" &&
            market.status !== "cancelled" && <CountdownTimer deadline={market.deadline} />}
        </CardContent>
      </Card>
    </Link>
  );
}
