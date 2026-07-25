import { Card, CardContent } from "@/components/ui/card";
import { BetStatusBadge } from "./BetStatusBadge";
import { CountdownTimer } from "./CountdownTimer";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatDate } from "@/lib/utils/formatDate";
import type { BetWithDetails } from "@/lib/types";

interface BetDetailProps {
  bet: BetWithDetails;
  currentUserId: string;
}

export function BetDetail({ bet, currentUserId }: BetDetailProps) {
  const sideA = bet.bet_participants.find((p) => p.side === "a");
  const sideB = bet.bet_participants.find((p) => p.side === "b");
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

      {/* Stake */}
      <div className="flex items-center gap-2">
        <span className="text-3xl font-black text-primary">{formatCurrency(bet.stake)}</span>
        <span className="text-muted-foreground text-sm">on the line</span>
      </div>

      {/* Sides */}
      <div className="grid grid-cols-2 gap-3">
        <Card className={`${userSide === "a" ? "border-primary/50 bg-primary/5" : ""}`}>
          <CardContent className="p-3">
            <p className="text-[10px] font-black tracking-widest text-muted-foreground mb-1">SIDE A</p>
            <p className="font-bold text-sm">{bet.side_a_label}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {sideA?.profiles?.display_name ?? sideA?.profiles?.username ?? "—"}
              {userSide === "a" && <span className="text-primary ml-1">(you)</span>}
            </p>
          </CardContent>
        </Card>

        <Card className={`${userSide === "b" ? "border-primary/50 bg-primary/5" : ""}`}>
          <CardContent className="p-3">
            <p className="text-[10px] font-black tracking-widest text-muted-foreground mb-1">SIDE B</p>
            <p className="font-bold text-sm">{bet.side_b_label}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {sideB?.profiles?.display_name ?? sideB?.profiles?.username ?? (
                <span className="text-primary">Waiting…</span>
              )}
              {userSide === "b" && <span className="text-primary ml-1">(you)</span>}
            </p>
          </CardContent>
        </Card>
      </div>

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
