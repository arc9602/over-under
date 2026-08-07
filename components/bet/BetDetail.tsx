import { Card, CardContent } from "@/components/ui/card";
import { BetStatusBadge } from "./BetStatusBadge";
import { CountdownTimer } from "./CountdownTimer";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatDate } from "@/lib/utils/formatDate";
import { getSideTotals } from "@/lib/utils/betPool";
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
        <div className="flex items-center justify-between">
          <p className="font-bold text-sm">{label}</p>
          <p className="text-sm font-black text-primary">{formatCurrency(total)}</p>
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Waiting for wagers…</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {p.profiles?.display_name ?? p.profiles?.username}
                  {p.user_id === currentUserId && <span className="text-primary ml-1">(you)</span>}
                </span>
                <span className="font-medium">{formatCurrency(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function BetDetail({ bet, currentUserId }: BetDetailProps) {
  const sideA = getSideTotals(bet.bet_participants, "a");
  const sideB = getSideTotals(bet.bet_participants, "b");
  const totalPool = sideA.total + sideB.total;
  const userSide = bet.bet_participants.find((p) => p.user_id === currentUserId)?.side;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black leading-tight">{bet.title}</h1>
          {bet.description && (
            <p className="text-muted-foreground text-sm mt-1">{bet.description}</p>
          )}
        </div>
        <BetStatusBadge status={bet.status} />
      </div>

      {/* Pool */}
      <div className="flex items-center gap-2">
        <span className="text-3xl font-black text-primary">{formatCurrency(totalPool)}</span>
        <span className="text-muted-foreground text-sm">in the pool</span>
      </div>

      {/* Sides */}
      <div className="grid grid-cols-2 gap-3">
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
      </div>

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
