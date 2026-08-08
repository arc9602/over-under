import type { IouEntry } from "@/lib/types";

/**
 * Portfolio stats derived from the IOU ledger the balances page already
 * loads. Pure functions over rows in memory -- no new queries, no schema
 * changes. The ledger is the only record of settled outcomes, so it is the
 * honest source for both lifetime P&L and win rate.
 */

/** Signed contribution of one IOU from `userId`'s perspective. */
function signedAmount(iou: IouEntry, userId: string): number {
  return iou.creditor_id === userId ? iou.amount : -iou.amount;
}

export type NetBalancePoint = {
  timestamp: number;
  net: number;
};

/**
 * Running lifetime net across every IOU, oldest first -- what the sparkline
 * on the portfolio header plots. Includes settled rows on purpose: settling
 * up squares the debt but doesn't undo the win.
 */
export function getNetBalanceHistory(ledger: IouEntry[], userId: string): NetBalancePoint[] {
  const sorted = [...ledger].sort((a, b) => a.created_at.localeCompare(b.created_at));
  let net = 0;

  return sorted.map((iou) => {
    net += signedAmount(iou, userId);
    return { timestamp: new Date(iou.created_at).getTime(), net };
  });
}

export type PortfolioStats = {
  /** Lifetime net across all IOUs, settled or not. */
  lifetimeNet: number;
  /** Settled events won / total settled events. Null when nothing settled yet. */
  winRate: number | null;
  wins: number;
  losses: number;
};

/**
 * Lifetime totals. Win rate counts *events* (one bet or market), not ledger
 * rows -- a bet with three losers writes three IOUs to the same winner, and
 * counting rows would inflate that into three wins.
 */
export function getPortfolioStats(ledger: IouEntry[], userId: string): PortfolioStats {
  const bySource = new Map<string, number>();
  let lifetimeNet = 0;

  for (const iou of ledger) {
    const amount = signedAmount(iou, userId);
    lifetimeNet += amount;

    const sourceId = iou.bet_id ?? iou.market_id;
    if (!sourceId) continue;
    bySource.set(sourceId, (bySource.get(sourceId) ?? 0) + amount);
  }

  let wins = 0;
  let losses = 0;
  for (const net of bySource.values()) {
    if (net > 0) wins++;
    else if (net < 0) losses++;
  }

  const decided = wins + losses;
  return {
    lifetimeNet,
    winRate: decided > 0 ? (wins / decided) * 100 : null,
    wins,
    losses,
  };
}
