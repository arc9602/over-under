"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ProbabilityChart } from "@/components/charts/ProbabilityChart";
import { TimeframeTabs } from "@/components/charts/TimeframeTabs";
import { cn } from "@/lib/utils";
import { filterByTimeframe, downsampleSeries, formatTooltipTime } from "@/lib/utils/chartData";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatCents } from "@/lib/utils/marketBook";
import type { UserPositionPoint, Timeframe, MarketSide } from "@/lib/types";

/**
 * Bets/Positions view: how a single user's position in one market has
 * performed since their first fill. `data`, `referenceOdds`, and `side` come
 * straight from lib/utils/marketBook.ts#getPositionHistory -- pass its
 * output through unchanged. The line tracks the market's odds (so it shares
 * an axis with MarketOddsChart), while $ P&L / position value are called out
 * as a stat header and a profit/loss background tint rather than a second
 * plotted axis.
 */

interface BetPositionChartProps {
  data: UserPositionPoint[];
  referenceOdds: number | null;
  side: MarketSide | null;
  yesLabel: string;
  noLabel: string;
  className?: string;
}

export function BetPositionChart({
  data,
  referenceOdds,
  side,
  yesLabel,
  noLabel,
  className,
}: BetPositionChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("ALL");
  const [hovered, setHovered] = useState<UserPositionPoint | null>(null);

  const visible = useMemo(
    () => downsampleSeries(filterByTimeframe(data, timeframe)),
    [data, timeframe]
  );

  const latest = data.length > 0 ? data[data.length - 1] : null;
  const shown = hovered ?? latest;

  // Profit state drives the tint/line color and stays pinned to the latest
  // point while scrubbing, so the chart doesn't flip color mid-drag.
  const inProfit = (latest?.pnl ?? 0) >= 0;
  const sideLabel = side === "yes" ? yesLabel : side === "no" ? noLabel : null;

  const costBasis = shown ? shown.positionValue - shown.pnl : 0;
  const pnlPct = shown && costBasis !== 0 ? (shown.pnl / costBasis) * 100 : 0;

  return (
    <Card className={cn(data.length > 0 && (inProfit ? "bg-emerald-500/5" : "bg-rose-500/5"), className)}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase truncate">
              {sideLabel ? `Holding ${sideLabel}` : "Position"}
            </p>
            {shown ? (
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-3xl font-black tabular-nums",
                    shown.pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                  )}
                >
                  {shown.pnl >= 0 ? "+" : "−"}
                  {formatCurrency(Math.abs(shown.pnl))}
                </span>
                <span
                  className={cn(
                    "text-xs font-bold tabular-nums",
                    shown.pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                  )}
                >
                  {shown.pnl >= 0 ? "+" : ""}
                  {pnlPct.toFixed(1)}%
                </span>
              </div>
            ) : (
              <span className="text-3xl font-black text-muted-foreground">—</span>
            )}
            <p className="text-xs text-muted-foreground">
              {shown ? `${formatCurrency(shown.positionValue)} value` : "No position"}
              {hovered && ` · ${formatTooltipTime(hovered.timestamp)}`}
            </p>
          </div>
          <TimeframeTabs value={timeframe} onChange={setTimeframe} />
        </div>

        <ProbabilityChart
          points={visible}
          getY={(p) => p.currentOdds}
          lineColorClassName={inProfit ? "text-emerald-400" : "text-rose-400"}
          referenceY={referenceOdds}
          referenceLabel={referenceOdds != null ? `Avg entry ${formatCents(referenceOdds)}` : undefined}
          onHoverChange={setHovered}
          emptyMessage="No position yet"
          renderTooltip={(p) => (
            <div className="space-y-0.5">
              <p className="text-muted-foreground">{formatTooltipTime(p.timestamp)}</p>
              <p className="font-bold tabular-nums">{Math.round(p.currentOdds)}% odds</p>
              <p className={cn("tabular-nums", p.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                {p.pnl >= 0 ? "+" : "−"}
                {formatCurrency(Math.abs(p.pnl))} · {formatCurrency(p.positionValue)} value
              </p>
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
}
