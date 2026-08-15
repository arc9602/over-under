import Link from "next/link";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SplitBar } from "@/components/shared/SplitBar";
import { BetStatusBadge } from "./BetStatusBadge";
import { CountdownTimer } from "./CountdownTimer";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import {
  getSideTotals,
  getPariMutuelPreview,
  getBetOptions,
  getOptionTotals,
  getOptionPariMutuelPreview,
} from "@/lib/utils/betPool";
import type { BetStatus, BetWithParticipants } from "@/lib/types";

interface BetCardProps {
  bet: BetWithParticipants;
  currentUserId: string;
}

// A bet in one of these has nothing left to decide -- it's a record of what
// happened, not a position that still needs the user's attention. Everything
// in A4's "terminal" treatment keys off this list.
const TERMINAL_STATUSES: BetStatus[] = ["resolved", "cancelled", "expired", "stuck"];

export function BetCard({ bet, currentUserId }: BetCardProps) {
  const options = getBetOptions(bet);
  const isTwoOption = options.length === 2;

  const sideA = getSideTotals(bet.bet_participants, "a");
  const sideB = getSideTotals(bet.bet_participants, "b");
  const optionTotals = options.map((o) => ({ option: o, ...getOptionTotals(bet.bet_participants, o.id) }));
  const totalPool = isTwoOption
    ? sideA.total + sideB.total
    : optionTotals.reduce((sum, o) => sum + o.total, 0);

  const mine = bet.bet_participants.find((p) => p.user_id === currentUserId);
  const preview = !mine
    ? null
    : isTwoOption
    ? getPariMutuelPreview(bet.bet_participants, mine.side!, currentUserId)
    : getOptionPariMutuelPreview(bet.bet_participants, mine.option_id!, currentUserId);

  const isTerminal = TERMINAL_STATUSES.includes(bet.status);
  const isResolving = bet.status === "resolving";

  // Which way the money is currently leaning -- a live signal, not a fixed
  // per-bet label, since option names are arbitrary and user-chosen.
  const favored = isTwoOption
    ? sideA.total === sideB.total
      ? null
      : sideA.total > sideB.total
      ? "a"
      : "b"
    : null;
  const leadingOption = !isTwoOption && optionTotals.length > 0
    ? optionTotals.reduce((max, o) => (o.total > max.total ? o : max), optionTotals[0])
    : null;

  return (
    <Link href={`/bets/${bet.id}`}>
      <Card
        className={cn(
          "transition-colors cursor-pointer",
          // State reads through opacity and ring weight, not color alone,
          // so the distinction survives for colorblind users too.
          isTerminal && "opacity-70 hover:border-border",
          isResolving && "ring-2 ring-resolving/40 hover:ring-resolving/60",
          !isTerminal && !isResolving && "hover:border-primary/40"
        )}
      >
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <BetStatusBadge status={bet.status} />
            {!isTerminal && isTwoOption && favored && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-semibold tracking-wide shrink-0",
                  favored === "a" ? "text-win" : "text-loss"
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
            {!isTerminal && !isTwoOption && leadingOption && leadingOption.total > 0 && (
              <span className="text-xs font-semibold tracking-wide text-primary shrink-0 truncate max-w-[45%]">
                Leading: {leadingOption.option.label}
              </span>
            )}
          </div>

          <p className="font-semibold text-sm leading-snug line-clamp-2">{bet.title}</p>

          {mine && preview ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Stake</p>
                <p
                  className={cn(
                    "font-bold tabular-nums",
                    // A settled bet's stake is context, not the headline
                    // figure it is while the bet is still live.
                    isTerminal ? "text-sm text-muted-foreground" : "text-base"
                  )}
                >
                  {formatCurrency(preview.wager)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Potential win</p>
                <p
                  className={cn(
                    "font-bold tabular-nums",
                    isTerminal
                      ? "text-sm text-muted-foreground"
                      : cn("text-base", isTwoOption ? (mine.side === "a" ? "text-win" : "text-loss") : "text-primary")
                  )}
                >
                  {formatCurrency(preview.payout)}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground tabular-nums">
              {totalPool > 0
                ? `${formatCurrency(totalPool)} in the pool`
                : isTerminal
                ? "No wagers were placed."
                : "Waiting for wagers"}
            </p>
          )}

          {!isTerminal && isTwoOption && <SplitBar leftValue={sideA.total} rightValue={sideB.total} />}

          {!isTerminal && bet.deadline && <CountdownTimer deadline={bet.deadline} />}
        </CardContent>
      </Card>
    </Link>
  );
}
