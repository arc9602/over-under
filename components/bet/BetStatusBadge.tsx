import { Badge } from "@/components/ui/badge";
import type { BetStatus } from "@/lib/types";

const config: Record<BetStatus, { label: string; className: string }> = {
  open: { label: "OPEN", className: "bg-secondary text-foreground border-border" },
  active: { label: "LIVE", className: "bg-primary/20 text-primary border-primary/30" },
  locked: { label: "LOCKED", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  resolving: { label: "RESOLVING", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  resolved: { label: "SETTLED", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  cancelled: { label: "CANCELLED", className: "bg-secondary text-muted-foreground border-border" },
  expired: { label: "EXPIRED", className: "bg-secondary text-muted-foreground border-border" },
  stuck: { label: "STUCK", className: "bg-destructive/20 text-destructive border-destructive/30" },
};

export function BetStatusBadge({ status }: { status: BetStatus }) {
  const { label, className } = config[status] ?? config.open;
  return (
    <Badge variant="outline" className={`text-[10px] font-black tracking-widest px-2 ${className}`}>
      {label}
    </Badge>
  );
}
