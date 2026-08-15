import { Badge } from "@/components/ui/badge";
import type { BetStatus } from "@/lib/types";

const config: Record<BetStatus, { label: string; className: string }> = {
  open: { label: "OPEN", className: "bg-secondary text-foreground border-border" },
  active: { label: "LIVE", className: "bg-primary/20 text-primary border-primary/30" },
  locked: { label: "LOCKED", className: "bg-resolving/20 text-resolving border-resolving/30" },
  resolving: { label: "RESOLVING", className: "bg-resolving/20 text-resolving border-resolving/30" },
  resolved: { label: "SETTLED", className: "bg-win/20 text-win border-win/30" },
  cancelled: { label: "CANCELLED", className: "bg-secondary text-muted-foreground border-border" },
  expired: { label: "EXPIRED", className: "bg-secondary text-muted-foreground border-border" },
  stuck: { label: "STUCK", className: "bg-destructive/20 text-destructive border-destructive/30" },
};

export function BetStatusBadge({ status }: { status: BetStatus }) {
  const { label, className } = config[status] ?? config.open;
  // Badge already carries text-xs/font-medium from its own variants; a status
  // label doesn't need to fight the type scale to be legible.
  return (
    <Badge variant="outline" className={`tracking-wide px-2 ${className}`}>
      {label}
    </Badge>
  );
}
