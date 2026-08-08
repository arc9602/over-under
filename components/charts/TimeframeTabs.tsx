"use client";

import { TIMEFRAMES, type Timeframe } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TimeframeTabsProps {
  value: Timeframe;
  onChange: (timeframe: Timeframe) => void;
  className?: string;
}

export function TimeframeTabs({ value, onChange, className }: TimeframeTabsProps) {
  return (
    <div className={cn("flex items-center gap-0.5", className)} role="tablist" aria-label="Timeframe">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          role="tab"
          aria-selected={value === tf}
          onClick={() => onChange(tf)}
          className={cn(
            "px-2 py-1 rounded text-[11px] font-bold tracking-wide transition-colors",
            value === tf
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
