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
import { getBetOutcome } from "@/lib/utils/betOutcome";
import { TERMINAL_STATUSES, type BetWithDetails } from "@/lib/types";

interface BetCardProps {
  bet: BetWithDetails;
  currentUserId: string;
}

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
  const isTerminal = TERMINAL_STATUSES.includes(bet.status);
  const isResolving = bet.status === "resolving";

  // "What if my side wins?" -- a live projection, only meaningful while the
  // bet hasn't actually resolved. Asking it after resolution is the bug this
  // card used to have: from this call's point of view the user's own side
  // always "wins", so it's null once there's a real outcome to show instead.
  const preview = !mine || isTerminal
    ? null
    : isTwoOption
    ? getPariMutuelPreview(bet.bet_participants, mine.side!, currentUserId)
    : getOptionPariMutuelPreview(bet.bet_participants, mine.option_id!, currentUserId);

  // What actually happened, from the bet's confirmed resolution. Only ever
  // non-"none" for a resolved bet with a confirmed row -- see getBetOutcome
  // for why an unconfirmed resolution, a cancellation, an expiry, or a stuck
  // bet all correctly fall out to no outcome claim.
  const outcome = mine
    ? getBetOutcome(bet.bet_participants, bet.resolutions, currentUserId, isTwoOption)
    : ({ kind: "none" } as const);

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
          "transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-[var(--ease-out)] cursor-pointer active:scale-[0.99] motion-reduce:active:scale-100",
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
                <p className="font-bold text-base tabular-nums">{formatCurrency(preview.wager)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Potential win</p>
                {/* Net, like the settled figure directly below it in the list.
                    A "win" is what you gain; the gross payout hands your own
                    stake back and counts it as winnings, so a $5 stake standing
                    to return $10 read as a $10 win rather than a $5 one. */}
                <p
                  className={cn(
                    "font-bold text-base tabular-nums",
                    isTwoOption ? (mine.side === "a" ? "text-win" : "text-loss") : "text-primary"
                  )}
                >
                  +{formatCurrency(preview.profit)}
                </p>
              </div>
            </div>
          ) : mine && outcome.kind !== "none" ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Stake</p>
                <p className="font-semibold text-sm text-muted-foreground tabular-nums">
                  {formatCurrency(mine.amount)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">{outcome.kind === "won" ? "Won" : "Lost"}</p>
                {/* Signed the same way BetWagerChart signs its line, so the two
                    never disagree about what a result was worth. */}
                <p
                  className={cn(
                    "font-semibold text-sm tabular-nums",
                    outcome.kind === "won" ? "text-win" : "text-loss"
                  )}
                >
                  {outcome.net >= 0 ? "+" : "−"}
                  {formatCurrency(Math.abs(outcome.net))}
                </p>
              </div>
            </div>
          ) : mine ? (
            // Terminal with no confirmed outcome to report: resolved but
            // unconfirmed, cancelled, expired, or stuck. Deliberately neutral
            // -- cancelBet (lib/actions/bets.ts) only flips bets.status; it
            // never touches bet_participants or any escrow/ledger row, so
            // there is nothing here to honestly call "returned."
            <div>
              <p className="text-xs text-muted-foreground">Stake</p>
              <p className="font-semibold text-sm text-muted-foreground tabular-nums">
                {formatCurrency(mine.amount)}
              </p>
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
