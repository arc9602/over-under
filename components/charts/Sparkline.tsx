import { cn } from "@/lib/utils";

/**
 * Decorative trend line for a stat tile (e.g. net balance over time).
 * Auto-scaled to its own values, no axes/gridlines/tooltip -- this is the
 * "12-point sparkline" stat-tile accent, not a chart someone reads values
 * off of. Use ProbabilityChart for anything that needs a real axis.
 */

interface SparklineProps {
  values: number[];
  colorClassName?: string;
  height?: number;
  className?: string;
}

const VIEW_W = 200;

export function Sparkline({ values, colorClassName = "text-primary", height = 48, className }: SparklineProps) {
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 3;

  const points = values.map((v, i) => {
    const x = values.length <= 1 ? VIEW_W / 2 : (i / (values.length - 1)) * VIEW_W;
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath =
    points.length > 1
      ? `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`
      : "";

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full", colorClassName, className)}
      style={{ height }}
      aria-hidden="true"
    >
      {areaPath && <path d={areaPath} fill="currentColor" fillOpacity={0.12} stroke="none" />}
      <path
        d={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
