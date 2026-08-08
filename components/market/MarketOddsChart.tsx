"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ProbabilityChart } from "@/components/charts/ProbabilityChart";
import { TimeframeTabs } from "@/components/charts/TimeframeTabs";
import { filterByTimeframe, downsampleSeries, formatTooltipTime } from "@/lib/utils/chartData";
import type { MarketOddsPoint, Timeframe } from "@/lib/types";

/**
 * Market Detail's odds-over-time chart. `data` must already be sorted
 * ascending by timestamp (lib/utils/marketBook.ts#getOddsHistory produces
 * this shape straight from market_fills, so real usage is just handing that
 * through -- see the mock generators in lib/mocks/chartMockData.ts for the
 * shape a WebSocket feed should append to).
 */

interface MarketOddsChartProps {
  data: MarketOddsPoint[];
  yesLabel: string;
  noLabel: string;
  className?: string;
}

export function MarketOddsChart({ data, yesLabel, noLabel, className }: MarketOddsChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const [hovered, setHovered] = useState<MarketOddsPoint | null>(null);

  const visible = useMemo(
    () => downsampleSeries(filterByTimeframe(data, timeframe)),
    [data, timeframe]
  );

  const latest = data.length > 0 ? data[data.length - 1] : null;
  const shown = hovered ?? latest;

  // The line's color reflects the current state and stays fixed while
  // scrubbing, so it doesn't flicker as the crosshair crosses 50%.
  const lineFavorsYes = (latest?.yesProbability ?? 50) >= 50;
  const shownFavorsYes = (shown?.yesProbability ?? 50) >= 50;

  return (
    <Card className={className}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase truncate">
              {shown ? (shownFavorsYes ? yesLabel : noLabel) : "Odds"}
            </p>
            {shown ? (
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-3xl font-black tabular-nums ${
                    shownFavorsYes ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {Math.round(shownFavorsYes ? shown.yesProbability : shown.noProbability)}%
                </span>
                <span className="text-xs text-muted-foreground">
                  {hovered ? formatTooltipTime(hovered.timestamp) : "current"}
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
          getY={(p) => p.yesProbability}
          lineColorClassName={lineFavorsYes ? "text-emerald-400" : "text-rose-400"}
          onHoverChange={setHovered}
          emptyMessage="No trades yet"
          renderTooltip={(p) => (
            <div className="space-y-0.5">
              <p className="text-muted-foreground">{formatTooltipTime(p.timestamp)}</p>
              <p className="font-bold tabular-nums">
                {yesLabel} {Math.round(p.yesProbability)}% · {noLabel} {Math.round(p.noProbability)}%
              </p>
              <p className="text-muted-foreground">
                {p.volume} {p.volume === 1 ? "contract" : "contracts"} traded
              </p>
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
}
