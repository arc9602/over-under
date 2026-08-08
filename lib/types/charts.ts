/**
 * Shared shapes for the odds/position history charts (MarketOddsChart,
 * BetPositionChart). Kept separate from database.types.ts because these
 * points are derived/aggregated client-side, not table rows.
 */

export const TIMEFRAMES = ["1H", "1D", "1W", "1M", "ALL"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** One tick of a market's traded odds, in probability-percent (0-100) terms. */
export interface MarketOddsPoint {
  /** Epoch ms. */
  timestamp: number;
  /** 0-100. yesProbability + noProbability always sum to 100. */
  yesProbability: number;
  noProbability: number;
  /** Cumulative contracts traded through this point. */
  volume: number;
}

/**
 * One tick of a user's position in a market, from entry onward. `currentOdds`
 * tracks the market (not the user), so the line can be drawn against the same
 * 0-100 axis as MarketOddsPoint; the rest describe the user's stake as of
 * that moment.
 */
export interface UserPositionPoint {
  timestamp: number;
  /** Market yes-probability at this point, 0-100. */
  currentOdds: number;
  /** Mark-to-market dollar value of the held position at currentOdds. */
  positionValue: number;
  /** Blended dollar cost per contract across whichever side(s) are held. */
  averageEntryPrice: number;
  /** Dollars: positionValue minus cost basis. */
  pnl: number;
}

/**
 * One point in a pari-mutuel bet's pool-share history. Bets have no traded
 * price -- `sideAProbability` is an *implied* probability derived from how
 * the pool is currently split, not a discovered market price. Recomputed
 * every time a participant's stake changes.
 */
export interface BetPoolPoint {
  timestamp: number;
  /** Side A's share of the pool, 0-100. Always 50 with an empty pool. */
  sideAProbability: number;
  sideBProbability: number;
  /** Cumulative dollars wagered through this point. */
  poolTotal: number;
}

/**
 * One point in a single user's pari-mutuel position, from their entry
 * onward. Unlike a market, a bet has no continuous price to mark against --
 * `projectedPayout` is "if this resolved in my favor using the pool split
 * *right now*", recomputed each time the pool changes.
 */
export interface UserBetPoolPoint {
  timestamp: number;
  /** Implied win probability of the user's side at this point, 0-100. */
  currentOdds: number;
  /** Payout if the bet resolved in the user's favor at this point's pool split. */
  projectedPayout: number;
  /** The user's total stake. Fixed across all points: bet_participants keeps
   *  one row per user, so top-ups don't carry their own historical timestamp. */
  wager: number;
  /** projectedPayout - wager. */
  pnl: number;
}
