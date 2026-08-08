"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared rendering primitive behind every odds/pool-share chart (markets and
 * bets alike): a 0-100 axis line chart with a crosshair/tooltip and an
 * optional dashed reference line. Callers own their own data (timeframe
 * filtering, downsampling, hover-driven headers) -- this component only draws.
 */

const VIEW_W = 600;
const VIEW_H = 220;
const PAD_X = 8;
const PAD_Y = 12;
const GRID_STEPS = [0, 25, 50, 75, 100];

type Point = { x: number; y: number };

function yFor(value: number): number {
  const clamped = Math.max(0, Math.min(100, value));
  return PAD_Y + (1 - clamped / 100) * (VIEW_H - PAD_Y * 2);
}

function xFor(index: number, count: number): number {
  if (count <= 1) return VIEW_W / 2;
  return PAD_X + (index / (count - 1)) * (VIEW_W - PAD_X * 2);
}

/** Step-after path: the price holds flat until the next trade, then jumps --
 *  the true shape of tick data, softened visually by round line joins. */
function buildStepPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    d += ` L ${curr.x} ${prev.y} L ${curr.x} ${curr.y}`;
  }
  return d;
}

interface ProbabilityChartProps<T> {
  points: T[];
  getY: (point: T) => number;
  /** Tailwind text-color class; used as `currentColor` for stroke/fill. */
  lineColorClassName?: string;
  /** Dashed horizontal reference (e.g. avg entry price), 0-100. */
  referenceY?: number | null;
  referenceLabel?: string;
  onHoverChange?: (point: T | null) => void;
  renderTooltip: (point: T) => ReactNode;
  emptyMessage?: string;
}

export function ProbabilityChart<T>({
  points,
  getY,
  lineColorClassName = "text-primary",
  referenceY,
  referenceLabel,
  onHoverChange,
  renderTooltip,
  emptyMessage = "No data yet",
}: ProbabilityChartProps<T>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const plotted = useMemo(
    () => points.map((p, i) => ({ x: xFor(i, points.length), y: yFor(getY(p)) })),
    [points, getY]
  );

  const linePath = useMemo(() => buildStepPath(plotted), [plotted]);
  const areaPath = useMemo(() => {
    if (plotted.length === 0) return "";
    if (plotted.length === 1) return "";
    const last = plotted[plotted.length - 1];
    const first = plotted[0];
    return `${linePath} L ${last.x} ${VIEW_H - PAD_Y / 2} L ${first.x} ${VIEW_H - PAD_Y / 2} Z`;
  }, [linePath, plotted]);

  function updateHover(clientX: number) {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const viewX = fraction * VIEW_W;

    let nearest = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < plotted.length; i++) {
      const dist = Math.abs(plotted[i].x - viewX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    }
    setHoverIndex(nearest);
    onHoverChange?.(points[nearest]);
  }

  function clearHover() {
    setHoverIndex(null);
    onHoverChange?.(null);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (points.length === 0) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const next = Math.max(0, (hoverIndex ?? points.length - 1) - 1);
      setHoverIndex(next);
      onHoverChange?.(points[next]);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = Math.min(points.length - 1, (hoverIndex ?? points.length - 1) + 1);
      setHoverIndex(next);
      onHoverChange?.(points[next]);
    } else if (e.key === "Escape") {
      clearHover();
    }
  }

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height: VIEW_H / 2 }}
      >
        {emptyMessage}
      </div>
    );
  }

  const hovered = hoverIndex != null ? points[hoverIndex] : null;
  const hoverPoint = hoverIndex != null ? plotted[hoverIndex] : null;
  const referenceYPos = referenceY != null ? yFor(referenceY) : null;

  return (
    <div className="relative select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className={cn("w-full touch-none", lineColorClassName)}
        style={{ height: VIEW_H }}
        aria-label="Probability over time, use arrow keys to scrub"
        tabIndex={0}
        onPointerMove={(e) => updateHover(e.clientX)}
        onPointerLeave={clearHover}
        onKeyDown={handleKeyDown}
        onBlur={clearHover}
      >
        {GRID_STEPS.map((step) => (
          <line
            key={step}
            x1={0}
            x2={VIEW_W}
            y1={yFor(step)}
            y2={yFor(step)}
            className="stroke-foreground/10"
            strokeWidth={1}
          />
        ))}

        {referenceYPos != null && (
          <line
            x1={PAD_X}
            x2={VIEW_W - PAD_X}
            y1={referenceYPos}
            y2={referenceYPos}
            className="stroke-muted-foreground/50"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}

        {areaPath && <path d={areaPath} fill="currentColor" fillOpacity={0.1} stroke="none" />}

        <path
          d={linePath}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {plotted.length === 1 && (
          <circle
            cx={plotted[0].x}
            cy={plotted[0].y}
            r={4}
            fill="currentColor"
            className="stroke-card"
            strokeWidth={2}
          />
        )}

        {hoverPoint && (
          <>
            <line
              x1={hoverPoint.x}
              x2={hoverPoint.x}
              y1={PAD_Y}
              y2={VIEW_H - PAD_Y}
              className="stroke-foreground/30"
              strokeWidth={1}
            />
            <circle
              cx={hoverPoint.x}
              cy={hoverPoint.y}
              r={4}
              fill="currentColor"
              className="stroke-card"
              strokeWidth={2}
            />
          </>
        )}
      </svg>

      {referenceLabel && referenceYPos != null && (
        <span
          className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground bg-card/80 px-1 rounded"
          style={{ top: `${(referenceYPos / VIEW_H) * 100}%` }}
        >
          {referenceLabel}
        </span>
      )}

      {hovered && hoverPoint && (
        <div
          className="absolute top-1 pointer-events-none rounded-md bg-popover text-popover-foreground ring-1 ring-foreground/10 shadow-lg px-2.5 py-1.5 text-xs whitespace-nowrap"
          style={{
            left: `${(hoverPoint.x / VIEW_W) * 100}%`,
            transform:
              hoverPoint.x / VIEW_W > 0.7 ? "translateX(-100%)" : hoverPoint.x / VIEW_W < 0.15 ? "none" : "translateX(-50%)",
          }}
        >
          {renderTooltip(hovered)}
        </div>
      )}
    </div>
  );
}
