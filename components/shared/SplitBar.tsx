import { cn } from "@/lib/utils";

/** A thin two-color proportion bar -- e.g. stake split between two sides. */

interface SplitBarProps {
  leftValue: number;
  rightValue: number;
  leftColorClassName?: string;
  rightColorClassName?: string;
  className?: string;
}

export function SplitBar({
  leftValue,
  rightValue,
  leftColorClassName = "bg-win",
  rightColorClassName = "bg-loss",
  className,
}: SplitBarProps) {
  const total = leftValue + rightValue;
  // With no money on either side there is nothing to split -- a 50/50 bar
  // here would draw even odds out of thin air. Guarded here, not at call
  // sites, so no future caller can reintroduce the false signal.
  if (total === 0) return null;

  const leftPct = (leftValue / total) * 100;
  const rightPct = 100 - leftPct;

  return (
    <div className={cn("h-1.5 w-full rounded-full bg-secondary overflow-hidden flex gap-px", className)}>
      {leftPct > 0 && (
        <div className={cn("h-full rounded-full", leftColorClassName)} style={{ width: `${leftPct}%` }} />
      )}
      {rightPct > 0 && (
        <div className={cn("h-full rounded-full", rightColorClassName)} style={{ width: `${rightPct}%` }} />
      )}
    </div>
  );
}
