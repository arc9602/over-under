"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export interface SideChoiceOption {
  /** For a 2-option bet this is the bet_options row id, same as everywhere else. */
  id: string;
  label: string;
  /** Total already wagered on this option. */
  total: number;
  /** How many distinct people have wagered on it. */
  count: number;
  /** Display names of everyone on this option, in a stable order. Not capped -- SideChoice applies the overflow rule. */
  names: string[];
}

interface SideChoiceProps {
  options: SideChoiceOption[];
  value: string | null;
  onChange: (optionId: string) => void;
  /** Accessible name for the radio group, e.g. the bet's own title. */
  groupLabel: string;
  id?: string;
}

/**
 * The focal control of the invite-arrival page: one real radio per option,
 * restyled, not a `div` with an onClick. Native `<input type="radio">`
 * elements sharing one `name` get arrow-key navigation and group semantics
 * for free from the browser -- hand-rolling role="radio" + keydown handling
 * would just be reimplementing that, worse.
 *
 * Handles 2 to 6 options (bet_options supports up to 10) with a reflowing
 * grid instead of a hardcoded column count, since a fixed 2-column layout
 * breaks past 4 options.
 */
export function SideChoice({ options, value, onChange, groupLabel, id }: SideChoiceProps) {
  const groupName = id ?? "side-choice";

  return (
    <div
      role="radiogroup"
      aria-label={groupLabel}
      className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2"
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <label
            key={option.id}
            className={cn(
              "relative flex min-h-11 cursor-pointer flex-col justify-center gap-1 rounded-lg border-2 p-3 transition-colors",
              selected
                ? "border-primary bg-primary/10"
                : "border-border bg-secondary/40 hover:bg-secondary/60"
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={option.id}
              checked={selected}
              onChange={() => onChange(option.id)}
              className="peer sr-only"
            />
            {/* Focus ring lives on an overlay, not the (visually hidden) input itself,
                so keyboard focus is still visible even though the input has no box. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-lg peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background"
            />

            <span className="flex items-center justify-between gap-1">
              <span className={cn("truncate text-sm font-bold leading-tight", selected && "text-primary")}>
                {option.label}
              </span>
              {/* Selected state can't rely on color alone -- this check mark is the
                  shape-based signal a colorblind user still gets. */}
              {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
            </span>

            <span className="text-xs font-bold tabular-nums text-foreground">
              {option.count > 0 ? formatCurrency(option.total) : "No one yet"}
            </span>

            {option.names.length > 0 && (
              <span className="text-[11px] leading-snug text-muted-foreground">
                {formatNames(option.names)}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}

/** "Alice, Bob, Carol" up to 3, then "Alice, Bob, Carol +2 more" beyond that. */
function formatNames(names: string[]): string {
  const shown = names.slice(0, 3);
  const remaining = names.length - shown.length;
  return remaining > 0 ? `${shown.join(", ")} +${remaining} more` : shown.join(", ");
}
