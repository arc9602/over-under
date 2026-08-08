"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ProbabilityChart } from "@/components/charts/ProbabilityChart";
import { TimeframeTabs } from "@/components/charts/TimeframeTabs";
import { filterByTimeframe, downsampleSeries, formatTooltipTime } from "@/lib/utils/chartData";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import type { BetPoolPoint, Timeframe } from "@/lib/types";

/**
 * BetDetail's pool-share chart: the pari-mutuel analogue of MarketOddsChart.
 * `data` comes from lib/utils/betPool.ts#getPoolHistory -- an *implied*
 * probability derived from how the pool is split, not a traded price, since
 * flat-stake bets have no order book. See that function's doc comment for
 * the one-row-per-user caveat on top-ups.
 */

interface BetPoolChartProps {
  data: BetPoolPoint[];
  sideALabel: string;
  sideBLabel: string;
  className?: string;
}

export function BetPoolChart({ data, sideALabel, sideBLabel, className }: BetPoolChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("ALL");
  const [hovered, setHovered] = useState<BetPoolPoint | null>(null);

  const visible = useMemo(
    () => downsampleSeries(filterByTimeframe(data, timeframe)),
    [data, timeframe]
  );

  const latest = data.length > 0 ? data[data.length - 1] : null;
  const shown = hovered ?? latest;

  const lineFavorsA = (latest?.sideAProbability ?? 50) >= 50;
  const shownFavorsA = (shown?.sideAProbability ?? 50) >= 50;

  return (
    <Card className={className}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase truncate">
              {shown ? (shownFavorsA ? sideALabel : sideBLabel) : "Pool Split"}
            </p>
            {shown ? (
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-3xl font-black tabular-nums ${
                    shownFavorsA ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {Math.round(shownFavorsA ? shown.sideAProbability : shown.sideBProbability)}%
                </span>
                <span className="text-xs text-muted-foreground">
                  {hovered ? formatTooltipTime(hovered.timestamp) : "of pool"}
                </span>
              </div>
            ) : (
              <span className="text-3xl font-black text-muted-foreground">—</span>
            )}
          </div>
          <TimeframeTabs value={timeframe} onChange={setTimeframe} />
        </div>

        <ProbabilityChart
          points={visible}
          getY={(p) => p.sideAProbability}
          lineColorClassName={lineFavorsA ? "text-emerald-400" : "text-rose-400"}
          onHoverChange={setHovered}
          emptyMessage="No wagers yet"
          renderTooltip={(p) => (
            <div className="space-y-0.5">
              <p className="text-muted-foreground">{formatTooltipTime(p.timestamp)}</p>
              <p className="font-bold tabular-nums">
                {sideALabel} {Math.round(p.sideAProbability)}% · {sideBLabel} {Math.round(p.sideBProbability)}%
              </p>
              <p className="text-muted-foreground">{formatCurrency(p.poolTotal)} in the pool</p>
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
}
