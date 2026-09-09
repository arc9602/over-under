"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ProbabilityChart } from "@/components/charts/ProbabilityChart";
import { TimeframeTabs } from "@/components/charts/TimeframeTabs";
import { cn } from "@/lib/utils";
import { filterByTimeframe, downsampleSeries, formatTooltipTime } from "@/lib/utils/chartData";
import { formatStake } from "@/lib/utils/formatStake";
import type { UserBetPoolPoint, Timeframe } from "@/lib/types";

/**
 * A user's own wager, tracked against the pool split since they joined.
 * `data`/`referenceOdds`/`side` come from
 * lib/utils/betPool.ts#getUserPoolHistory. Leads with net profit/loss
 * (signed, buy-in excluded) rather than gross payout -- the payout figure
 * bundles the stake back in, which reads as bigger winnings than it is.
 */

interface BetWagerChartProps {
  data: UserBetPoolPoint[];
  referenceOdds: number | null;
  side: "a" | "b" | null;
  sideALabel: string;
  sideBLabel: string;
  /** What the stake is denominated in -- 'USD' is money (migration 022). */
  unit: string;
  unitPlural: string | null;
  className?: string;
}

export function BetWagerChart({
  data,
  referenceOdds,
  side,
  sideALabel,
  sideBLabel,
  unit,
  unitPlural,
  className,
}: BetWagerChartProps) {
  // Amounts here are in the bet's own stake unit, not necessarily dollars.
  const stake = (amount: number) =>
    formatStake(amount, unit, unitPlural);

  const [timeframe, setTimeframe] = useState<Timeframe>("ALL");
  const [hovered, setHovered] = useState<UserBetPoolPoint | null>(null);

  const visible = useMemo(
    () => downsampleSeries(filterByTimeframe(data, timeframe)),
    [data, timeframe]
  );

  const latest = data.length > 0 ? data[data.length - 1] : null;
  const shown = hovered ?? latest;
  const inProfit = (latest?.pnl ?? 0) >= 0;
  const sideLabel = side === "a" ? sideALabel : side === "b" ? sideBLabel : null;

  return (
    <Card className={cn(data.length > 0 && (inProfit ? "bg-win/5" : "bg-loss/5"), className)}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase truncate">
              {sideLabel ? `Net · ${sideLabel}` : "Net"}
            </p>
            {shown ? (
              <span
                className={cn(
                  "text-3xl font-semibold tabular-nums",
                  shown.pnl >= 0 ? "text-win" : "text-loss"
                )}
              >
                {shown.pnl >= 0 ? "+" : "−"}
                {stake(Math.abs(shown.pnl))}
              </span>
            ) : (
              <span className="text-3xl font-semibold text-muted-foreground">—</span>
            )}
            <p className="text-xs text-muted-foreground">
              {shown
                ? `${stake(shown.wager)} wagered · payout ${stake(shown.projectedPayout)}`
                : "No wager yet"}
              {hovered && ` · ${formatTooltipTime(hovered.timestamp)}`}
            </p>
          </div>
          <TimeframeTabs value={timeframe} onChange={setTimeframe} />
        </div>

        <ProbabilityChart
          points={visible}
          getY={(p) => p.currentOdds}
          lineColorClassName={inProfit ? "text-win" : "text-loss"}
          referenceY={referenceOdds}
          referenceLabel={referenceOdds != null ? `Entry ${referenceOdds}%` : undefined}
          onHoverChange={setHovered}
          emptyMessage="No wager yet"
          renderTooltip={(p) => (
            <div className="space-y-0.5">
              <p className="text-muted-foreground">{formatTooltipTime(p.timestamp)}</p>
              <p className="font-bold tabular-nums">{Math.round(p.currentOdds)}% pool share</p>
              <p className={cn("tabular-nums", p.pnl >= 0 ? "text-win" : "text-loss")}>
                {p.pnl >= 0 ? "+" : "−"}
                {stake(Math.abs(p.pnl))} net
              </p>
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
}
