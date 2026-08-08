import Link from "next/link";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SplitBar } from "@/components/shared/SplitBar";
import { BetStatusBadge } from "./BetStatusBadge";
import { CountdownTimer } from "./CountdownTimer";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getSideTotals, getPariMutuelPreview } from "@/lib/utils/betPool";
import type { BetWithParticipants } from "@/lib/types";

interface BetCardProps {
  bet: BetWithParticipants;
  currentUserId: string;
}

export function BetCard({ bet, currentUserId }: BetCardProps) {
  const sideA = getSideTotals(bet.bet_participants, "a");
  const sideB = getSideTotals(bet.bet_participants, "b");
  const totalPool = sideA.total + sideB.total;
  const mine = bet.bet_participants.find((p) => p.user_id === currentUserId);
  const preview = mine ? getPariMutuelPreview(bet.bet_participants, mine.side, currentUserId) : null;
  // Which way the money is currently leaning -- a live signal, not a fixed
  // per-bet label, since side_a/side_b are arbitrary user-chosen names.
  const favored = sideA.total === sideB.total ? null : sideA.total > sideB.total ? "a" : "b";

  return (
    <Link href={`/bets/${bet.id}`}>
      <Card className="hover:border-primary/40 transition-colors cursor-pointer">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <BetStatusBadge status={bet.status} />
            {favored && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[10px] font-black tracking-wide shrink-0",
                  favored === "a" ? "text-emerald-400" : "text-rose-400"
                )}
              >
                {favored === "a" ? (
                  <TrendingUp className="size-3" />
                ) : (
                  <TrendingDown className="size-3" />
                )}
                {favored === "a" ? bet.side_a_label : bet.side_b_label}
              </span>
            )}
          </div>

          <p className="font-bold text-sm leading-snug line-clamp-2">{bet.title}</p>

          {mine && preview ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Stake</p>
                <p className="text-sm font-black tabular-nums">{formatCurrency(preview.wager)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Potential Win</p>
                <p
                  className={cn(
                    "text-sm font-black tabular-nums",
                    mine.side === "a" ? "text-emerald-400" : "text-rose-400"
                  )}
                >
                  {formatCurrency(preview.payout)}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {totalPool > 0 ? `${formatCurrency(totalPool)} in the pool` : "Waiting for wagers"}
            </p>
          )}

          <SplitBar leftValue={sideA.total} rightValue={sideB.total} />

          {bet.deadline && bet.status !== "resolved" && bet.status !== "cancelled" && (
            <CountdownTimer deadline={bet.deadline} />
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
