import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { BetStatusBadge } from "./BetStatusBadge";
import { CountdownTimer } from "./CountdownTimer";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getOptionTotals, getTotalPool, sortBetOptions } from "@/lib/utils/betPool";
import type { BetWithParticipants } from "@/lib/types";

interface BetCardProps {
  bet: BetWithParticipants;
  currentUserId: string;
}

export function BetCard({ bet }: BetCardProps) {
  const options = sortBetOptions(bet.bet_options);
  const totalPool = getTotalPool(bet.bet_participants);
  const optionSummary = options
    .map((option) => {
      const totals = getOptionTotals(bet.bet_participants, option.id);
      return totals.count > 0
        ? `${option.label}: ${formatCurrency(totals.total)}`
        : `${option.label}: open`;
    })
    .join(" · ");

  return (
    <Link href={`/bets/${bet.id}`}>
      <Card className="hover:border-primary/40 transition-colors cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm leading-snug truncate">{bet.title}</p>
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                {options.map((option) => option.label).join(" · ")}
              </p>
              <p className="text-xs text-muted-foreground mt-2">{optionSummary}</p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <BetStatusBadge status={bet.status} />
              <span className="text-base font-black text-primary">
                {formatCurrency(totalPool)}
              </span>
              {bet.deadline && bet.status !== "resolved" && bet.status !== "cancelled" && (
                <CountdownTimer deadline={bet.deadline} />
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
