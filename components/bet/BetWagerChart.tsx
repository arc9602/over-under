"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ProbabilityChart } from "@/components/charts/ProbabilityChart";
import { TimeframeTabs } from "@/components/charts/TimeframeTabs";
import { cn } from "@/lib/utils";
import { filterByTimeframe, downsampleSeries, formatTooltipTime } from "@/lib/utils/chartData";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import type { UserBetPoolPoint, Timeframe } from "@/lib/types";

/**
 * A user's own wager, tracked against the pool split since they joined.
 * `data`/`referenceOdds`/`side` come from
 * lib/utils/betPool.ts#getUserPoolHistory. Leads with "Current Payout"
 * (what they'd get right now if this resolved their way) rather than $ P&L,
 * since that's the number people actually check a pari-mutuel bet for.
 */

interface BetWagerChartProps {
  data: UserBetPoolPoint[];
  referenceOdds: number | null;
  side: "a" | "b" | null;
  sideALabel: string;
  sideBLabel: string;
  className?: string;
}

export function BetWagerChart({
  data,
  referenceOdds,
  side,
  sideALabel,
  sideBLabel,
  className,
}: BetWagerChartProps) {
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
    <Card className={cn(data.length > 0 && (inProfit ? "bg-emerald-500/5" : "bg-rose-500/5"), className)}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase truncate">
              {sideLabel ? `Current Payout · ${sideLabel}` : "Current Payout"}
            </p>
            {shown ? (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black tabular-nums">
                  {formatCurrency(shown.projectedPayout)}
                </span>
                <span
                  className={cn(
                    "text-xs font-bold tabular-nums",
                    shown.pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                  )}
                >
                  {shown.pnl >= 0 ? "+" : "−"}
                  {formatCurrency(Math.abs(shown.pnl))}
                </span>
              </div>
            ) : (
              <span className="text-3xl font-black text-muted-foreground">—</span>
            )}
            <p className="text-xs text-muted-foreground">
              {shown ? `${formatCurrency(shown.wager)} wagered` : "No wager yet"}
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
          referenceLabel={referenceOdds != null ? `Entry ${referenceOdds}%` : undefined}
          onHoverChange={setHovered}
          emptyMessage="No wager yet"
          renderTooltip={(p) => (
            <div className="space-y-0.5">
              <p className="text-muted-foreground">{formatTooltipTime(p.timestamp)}</p>
              <p className="font-bold tabular-nums">{Math.round(p.currentOdds)}% pool share</p>
              <p className={cn("tabular-nums", p.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                Payout {formatCurrency(p.projectedPayout)} ({p.pnl >= 0 ? "+" : "−"}
                {formatCurrency(Math.abs(p.pnl))})
              </p>
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
}
