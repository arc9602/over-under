import { cn } from "@/lib/utils";

/** A single shimmering placeholder block. Sized by the caller. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded bg-secondary", className)}
      {...props}
    />
  );
}
