import { BetStatusBadge } from "@/components/bet/BetStatusBadge";
import { CountdownTimer } from "@/components/bet/CountdownTimer";
import { OrderBook } from "./OrderBook";
import { PositionCard } from "./PositionCard";
import { MarketOddsChart } from "./MarketOddsChart";
import { BetPositionChart } from "./BetPositionChart";
import { formatDate } from "@/lib/utils/formatDate";
import { formatCents, getOddsHistory, getPositionHistory } from "@/lib/utils/marketBook";
import type { MarketWithDetails } from "@/lib/types";

interface MarketDetailProps {
  market: MarketWithDetails;
  currentUserId: string;
}

export function MarketDetail({ market, currentUserId }: MarketDetailProps) {
  const volume = market.market_fills.reduce((sum, f) => sum + f.quantity, 0);
  const oddsHistory = getOddsHistory(market.market_fills);
  const positionHistory = getPositionHistory(market.market_fills, currentUserId);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold leading-tight">{market.title}</h1>
          {market.description && (
            <p className="text-muted-foreground text-sm mt-1">{market.description}</p>
          )}
        </div>
        <BetStatusBadge status={market.status} />
      </div>

      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-4xl font-semibold text-primary tabular-nums shrink-0">
          {market.last_price != null ? formatCents(market.last_price) : "—"}
        </span>
        <span className="text-muted-foreground text-sm truncate min-w-0">
          {market.last_price != null
            ? `last traded · ${market.yes_label}`
            : "not traded yet"}
        </span>
      </div>

      <MarketOddsChart
        data={oddsHistory}
        yesLabel={market.yes_label}
        noLabel={market.no_label}
      />

      <OrderBook
        orders={market.market_orders}
        yesLabel={market.yes_label}
        noLabel={market.no_label}
      />

      <PositionCard
        fills={market.market_fills}
        currentUserId={currentUserId}
        yesLabel={market.yes_label}
        noLabel={market.no_label}
      />

      {positionHistory.points.length > 0 && (
        <BetPositionChart
          data={positionHistory.points}
          referenceOdds={positionHistory.referenceOdds}
          side={positionHistory.side}
          yesLabel={market.yes_label}
          noLabel={market.no_label}
        />
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {volume} {volume === 1 ? "contract" : "contracts"} traded
        </span>
        <span>·</span>
        <span>Created {formatDate(market.created_at)}</span>
        {market.max_contracts != null && (
          <>
            <span>·</span>
            <span>Max {market.max_contracts} per side</span>
          </>
        )}
        {market.deadline && (
          <>
            <span>·</span>
            {market.status !== "resolved" && market.status !== "cancelled" ? (
              <CountdownTimer deadline={market.deadline} />
            ) : (
              <span>Deadline was {formatDate(market.deadline)}</span>
            )}
          </>
        )}
        {market.resolved_at && (
          <>
            <span>·</span>
            <span>Settled {formatDate(market.resolved_at)}</span>
          </>
        )}
      </div>
    </div>
  );
}
