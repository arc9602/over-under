import { cn } from "@/lib/utils";

/** Numbered step indicator for multi-step forms (e.g. Create Market). */

interface StepperProps {
  steps: string[];
  currentIndex: number;
  className?: string;
}

export function Stepper({ steps, currentIndex, className }: StepperProps) {
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div
              className={cn(
                "flex items-center justify-center h-6 w-6 shrink-0 rounded-full text-xs font-semibold transition-colors",
                i <= currentIndex ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
              )}
            >
              {i + 1}
            </div>
            {i < steps.length - 1 && (
              <div className={cn("h-px flex-1 mx-2", i < currentIndex ? "bg-primary" : "bg-border")} />
            )}
          </div>
        ))}
      </div>
      <div className="flex mt-1.5">
        {steps.map((label, i) => (
          <div key={label} className={cn("flex-1 last:flex-none last:text-right", i === 0 && "text-left")}>
            <span
              className={cn(
                "text-[10px] font-bold tracking-widest uppercase",
                i === currentIndex ? "text-primary" : "text-muted-foreground"
              )}
            >
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
