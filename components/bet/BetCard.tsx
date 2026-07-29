import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { BetStatusBadge } from "./BetStatusBadge";
import { CountdownTimer } from "./CountdownTimer";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getSideTotals } from "@/lib/utils/betPool";
import type { BetWithParticipants } from "@/lib/types";

interface BetCardProps {
  bet: BetWithParticipants;
  currentUserId: string;
}

export function BetCard({ bet }: BetCardProps) {
  const sideA = getSideTotals(bet.bet_participants, "a");
  const sideB = getSideTotals(bet.bet_participants, "b");
  const totalPool = sideA.total + sideB.total;

  return (
    <Link href={`/bets/${bet.id}`}>
      <Card className="hover:border-primary/40 transition-colors cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm leading-snug truncate">{bet.title}</p>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{bet.side_a_label}</span>
                  <span>vs</span>
                  <span className="font-medium text-foreground">{bet.side_b_label}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs text-muted-foreground">
                  {sideA.count > 0 ? `${formatCurrency(sideA.total)} (${sideA.count})` : "Open"}
                  {" vs "}
                  {sideB.count > 0 ? (
                    `${formatCurrency(sideB.total)} (${sideB.count})`
                  ) : (
                    <span className="text-primary">Waiting for wagers</span>
                  )}
                </span>
              </div>
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
