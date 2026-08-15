import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import {
  getPosition,
  getOutcomePreview,
  centsToDollars,
  formatCents,
} from "@/lib/utils/marketBook";
import type { MarketFill } from "@/lib/types";

interface PositionCardProps {
  fills: MarketFill[];
  currentUserId: string;
  yesLabel: string;
  noLabel: string;
}

function OutcomeRow({ label, profitCents }: { label: string; profitCents: number }) {
  const up = profitCents > 0;
  const flat = profitCents === 0;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground truncate">If {label}</span>
      <span
        className={`font-semibold tabular-nums ${
          flat ? "text-muted-foreground" : up ? "text-win" : "text-destructive"
        }`}
      >
        {flat
          ? formatCurrency(0)
          : up
          ? `+${formatCurrency(centsToDollars(profitCents))}`
          : `−${formatCurrency(centsToDollars(Math.abs(profitCents)))}`}
      </span>
    </div>
  );
}

export function PositionCard({ fills, currentUserId, yesLabel, noLabel }: PositionCardProps) {
  const position = getPosition(fills, currentUserId);
  if (!position.hasPosition) return null;

  const yesOutcome = getOutcomePreview(fills, currentUserId, "yes");
  const noOutcome = getOutcomePreview(fills, currentUserId, "no");
  // Fully offset: both outcomes pay the same, so the result is already locked in.
  const locked = position.net === 0 && yesOutcome.profitCents === noOutcome.profitCents;

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold tracking-widest text-primary">YOUR POSITION</p>
          <p className="text-xs text-muted-foreground">
            {formatCurrency(centsToDollars(position.costCents))} at risk
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded bg-background/60 p-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
              {yesLabel}
            </p>
            <p className="font-semibold text-win">{position.yes}</p>
            <p className="text-[10px] text-muted-foreground">
              {position.avgYesPrice != null ? `avg ${formatCents(position.avgYesPrice)}` : "—"}
            </p>
          </div>
          <div className="rounded bg-background/60 p-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
              {noLabel}
            </p>
            <p className="font-semibold text-loss">{position.no}</p>
            <p className="text-[10px] text-muted-foreground">
              {position.avgNoPrice != null ? `avg ${formatCents(position.avgNoPrice)}` : "—"}
            </p>
          </div>
        </div>

        <div className="space-y-1.5 border-t border-border pt-3">
          <OutcomeRow label={yesLabel} profitCents={yesOutcome.profitCents} />
          <OutcomeRow label={noLabel} profitCents={noOutcome.profitCents} />
        </div>

        {locked && (
          <p className="text-xs text-muted-foreground">
            You hold both sides in equal size — your result is locked in whichever way this resolves.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
