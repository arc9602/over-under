import { Card, CardContent } from "@/components/ui/card";
import { BetStatusBadge } from "./BetStatusBadge";
import { CountdownTimer } from "./CountdownTimer";
import { BetPoolChart } from "./BetPoolChart";
import { BetWagerChart } from "./BetWagerChart";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatDate } from "@/lib/utils/formatDate";
import {
  getSideTotals,
  getPoolHistory,
  getUserPoolHistory,
  getBetOptions,
  getOptionTotals,
} from "@/lib/utils/betPool";
import type { BetWithDetails } from "@/lib/types";

interface BetDetailProps {
  bet: BetWithDetails;
  currentUserId: string;
}

function SideList({
  label,
  rows,
  total,
  currentUserId,
  highlighted,
}: {
  label: string;
  rows: BetWithDetails["bet_participants"];
  total: number;
  currentUserId: string;
  highlighted: boolean;
}) {
  return (
    <Card className={highlighted ? "border-primary/50 bg-primary/5" : ""}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-bold text-sm truncate min-w-0">{label}</p>
          <p className="text-sm font-semibold text-primary tabular-nums shrink-0">
            {formatCurrency(total)}
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Waiting for wagers…</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground truncate min-w-0">
                  {p.profiles?.display_name ?? p.profiles?.username}
                  {p.user_id === currentUserId && <span className="text-primary ml-1">(you)</span>}
                </span>
                <span className="font-medium tabular-nums shrink-0">
                  {formatCurrency(p.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function BetDetail({ bet, currentUserId }: BetDetailProps) {
  const options = getBetOptions(bet);
  const isTwoOption = options.length === 2;
  const totalPool = bet.bet_participants.reduce((sum, p) => sum + p.amount, 0);

  // While the bet still takes wagers, WagerForm/OptionWagerForm is on screen
  // below and this is a "deciding" view -- the pool trend is always shown,
  // but the user's own wager chart stays hidden (the form's live
  // predicted-payout preview already covers that). Once wagering closes,
  // it's a "checking on it" view, so both charts show.
  const canStillWager = bet.status === "open" || bet.status === "active";

  // The 2-option chart pair (BetPoolChart/BetWagerChart) plots a single
  // 0-100 probability line and has no N-way equivalent yet -- see
  // components/bet/BetPoolChart.tsx. 3+-option bets get the same option
  // cards everyone else gets, just without those two charts.
  const sideA = isTwoOption ? getSideTotals(bet.bet_participants, "a") : null;
  const sideB = isTwoOption ? getSideTotals(bet.bet_participants, "b") : null;
  const userSide = bet.bet_participants.find((p) => p.user_id === currentUserId)?.side;
  const poolHistory = isTwoOption ? getPoolHistory(bet.bet_participants) : null;
  const userPoolHistory = isTwoOption
    ? getUserPoolHistory(bet.bet_participants, currentUserId)
    : null;

  const userOptionId = bet.bet_participants.find((p) => p.user_id === currentUserId)?.option_id;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold leading-tight">{bet.title}</h1>
          {bet.description && (
            <p className="text-muted-foreground text-sm mt-1">{bet.description}</p>
          )}
        </div>
        <BetStatusBadge status={bet.status} />
      </div>

      {/* Pool */}
      <div className="flex items-center gap-2">
        <span className="text-3xl font-semibold text-primary">{formatCurrency(totalPool)}</span>
        <span className="text-muted-foreground text-sm">in the pool</span>
      </div>

      {isTwoOption && poolHistory && (
        <BetPoolChart data={poolHistory} sideALabel={bet.side_a_label} sideBLabel={bet.side_b_label} />
      )}

      {/* Options */}
      <div className="grid grid-cols-2 gap-3">
        {isTwoOption && sideA && sideB ? (
          <>
            <SideList
              label={bet.side_a_label}
              rows={sideA.rows}
              total={sideA.total}
              currentUserId={currentUserId}
              highlighted={userSide === "a"}
            />
            <SideList
              label={bet.side_b_label}
              rows={sideB.rows}
              total={sideB.total}
              currentUserId={currentUserId}
              highlighted={userSide === "b"}
            />
          </>
        ) : (
          options.map((option) => {
            const totals = getOptionTotals(bet.bet_participants, option.id);
            return (
              <SideList
                key={option.id}
                label={option.label}
                rows={totals.rows}
                total={totals.total}
                currentUserId={currentUserId}
                highlighted={userOptionId === option.id}
              />
            );
          })
        )}
      </div>

      {!canStillWager && isTwoOption && userPoolHistory && userPoolHistory.points.length > 0 && (
        <BetWagerChart
          data={userPoolHistory.points}
          referenceOdds={userPoolHistory.referenceOdds}
          side={userPoolHistory.side}
          sideALabel={bet.side_a_label}
          sideBLabel={bet.side_b_label}
        />
      )}

      {(bet.min_wager != null || bet.max_wager != null) && (
        <p className="text-xs text-muted-foreground">
          {[
            bet.min_wager != null ? `Min wager ${formatCurrency(bet.min_wager)}` : null,
            bet.max_wager != null ? `Max wager ${formatCurrency(bet.max_wager)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {/* Meta */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>Created {formatDate(bet.created_at)}</span>
        {bet.deadline && (
          <>
            <span>·</span>
            {bet.status !== "resolved" && bet.status !== "cancelled" ? (
              <CountdownTimer deadline={bet.deadline} />
            ) : (
              <span>Deadline was {formatDate(bet.deadline)}</span>
            )}
          </>
        )}
        {bet.resolved_at && (
          <>
            <span>·</span>
            <span>Settled {formatDate(bet.resolved_at)}</span>
          </>
        )}
      </div>
    </div>
  );
}
