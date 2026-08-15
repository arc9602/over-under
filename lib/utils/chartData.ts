import type { Timeframe } from "@/lib/types/charts";

/**
 * Time-series bucketing/downsampling for the odds & position charts. Pure
 * functions over whatever point array the chart already has in memory --
 * same spirit as marketBook.ts, just for chart rendering instead of P&L math.
 */

const TIMEFRAME_MS: Record<Exclude<Timeframe, "ALL">, number> = {
  "1H": 60 * 60 * 1000,
  "1D": 24 * 60 * 60 * 1000,
  "1W": 7 * 24 * 60 * 60 * 1000,
  "1M": 30 * 24 * 60 * 60 * 1000,
};

/** A reasonable point budget for a chart rendered a few hundred px wide. */
export const DEFAULT_MAX_POINTS = 150;

/**
 * Restricts points to the trailing window for `timeframe`. If the window
 * would otherwise start mid-air (the first surviving point is already partway
 * through it), carries the last point from before the cutoff forward so the
 * line begins flat at the window edge instead of appearing to start from
 * nothing.
 */
export function filterByTimeframe<T extends { timestamp: number }>(
  points: T[],
  timeframe: Timeframe,
  now: number = Date.now()
): T[] {
  if (timeframe === "ALL") return points;

  const cutoff = now - TIMEFRAME_MS[timeframe];
  const kept = points.filter((p) => p.timestamp >= cutoff);

  if (kept.length === 0 || kept[0].timestamp > cutoff) {
    const before = points.filter((p) => p.timestamp < cutoff).at(-1);
    if (before) return [{ ...before, timestamp: cutoff }, ...kept];
  }

  return kept;
}

/**
 * Reduces `points` to at most `maxPoints` samples by keeping the latest point
 * observed within each equal-width time bucket -- last-observation-carried-
 * forward, the same way a step/candle chart collapses ticks. The true first
 * and last points always survive so the line's start and current value are
 * never approximated away.
 */
export function downsampleSeries<T extends { timestamp: number }>(
  points: T[],
  maxPoints: number = DEFAULT_MAX_POINTS
): T[] {
  if (points.length <= maxPoints || maxPoints < 2) return points;

  const first = points[0].timestamp;
  const last = points[points.length - 1].timestamp;
  const span = Math.max(1, last - first);
  const bucketMs = span / (maxPoints - 1);

  const buckets = new Map<number, T>();
  for (const p of points) {
    const bucketIndex = Math.min(maxPoints - 1, Math.floor((p.timestamp - first) / bucketMs));
    // Points are chronological, so the last write per bucket is the latest
    // observation in that slice.
    buckets.set(bucketIndex, p);
  }

  const result = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, p]) => p);

  if (result[0] !== points[0]) result.unshift(points[0]);
  if (result[result.length - 1] !== points[points.length - 1]) {
    result.push(points[points.length - 1]);
  }

  return result;
}

/** Full precision timestamp, for tooltips. */
export function formatTooltipTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
