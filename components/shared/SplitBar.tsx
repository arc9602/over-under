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
  leftColorClassName = "bg-emerald-400",
  rightColorClassName = "bg-rose-400",
  className,
}: SplitBarProps) {
  const total = leftValue + rightValue;
  const leftPct = total > 0 ? (leftValue / total) * 100 : 50;
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
