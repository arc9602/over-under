import type { MarketFill, MarketOrder, MarketSide } from "@/lib/types";
import type { MarketOddsPoint, UserPositionPoint } from "@/lib/types/charts";

/**
 * Order-book and position math. The market analogue of betPool.ts: pure
 * functions over the rows the page already loaded, so the UI never has to ask
 * the database a second question.
 *
 * Everything here works in integer cents. A contract settles at 100c, prices
 * run 1-99c, and a YES at price p is always paired against a NO at 100-p --
 * so the two sides of a fill always put up exactly a dollar between them.
 * Authoritative settlement numbers still come from confirm_market_resolution.
 */

export const CONTRACT_CENTS = 100;

export function otherSide(side: MarketSide): MarketSide {
  return side === "yes" ? "no" : "yes";
}

/** Cents -> dollars, for handing to formatCurrency. */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

/** A contract price, the way a prediction market writes it. */
export function formatCents(cents: number): string {
  return `${Math.round(cents)}¢`;
}

type BookLevel = {
  /** Price in cents for the requested side. */
  price: number;
  /** Contracts still available at this price. */
  quantity: number;
};

function restingQuantity(order: MarketOrder): number {
  return order.status === "open" ? order.quantity - order.filled_quantity : 0;
}

/**
 * Resting depth on one side, best (highest) price first. These are bids: a
 * resting YES at 60c is someone willing to pay 60c for YES.
 */
export function getBookLevels(orders: MarketOrder[], side: MarketSide): BookLevel[] {
  const byPrice = new Map<number, number>();

  for (const order of orders) {
    if (order.side !== side) continue;
    const qty = restingQuantity(order);
    if (qty <= 0) continue;
    byPrice.set(order.limit_price, (byPrice.get(order.limit_price) ?? 0) + qty);
  }

  return Array.from(byPrice.entries())
    .map(([price, quantity]) => ({ price, quantity }))
    .sort((a, b) => b.price - a.price);
}

/**
 * The cheapest price you could buy each side at right now, and how many
 * contracts are available there.
 *
 * There is no separate ask side in a binary market: to buy YES you match
 * against a resting NO bid, and a NO resting at q means YES is available at
 * 100-q. The best (lowest) YES ask therefore comes from the highest NO bid.
 */
export function getBestPrices(orders: MarketOrder[]): {
  yes: { price: number; quantity: number } | null;
  no: { price: number; quantity: number } | null;
} {
  const yesBids = getBookLevels(orders, "yes");
  const noBids = getBookLevels(orders, "no");

  const bestNoBid = noBids[0];
  const bestYesBid = yesBids[0];

  return {
    yes: bestNoBid
      ? { price: CONTRACT_CENTS - bestNoBid.price, quantity: bestNoBid.quantity }
      : null,
    no: bestYesBid
      ? { price: CONTRACT_CENTS - bestYesBid.price, quantity: bestYesBid.quantity }
      : null,
  };
}

/**
 * How much of `quantity` at `limitPrice` would fill immediately against the
 * book, and at what average price. Mirrors the matching rule in
 * place_market_order: resting orders transact at their own limit price, so the
 * aggressor often pays less than its limit.
 */
export function previewFill(
  orders: MarketOrder[],
  userId: string,
  side: MarketSide,
  limitPrice: number,
  quantity: number
): { filled: number; resting: number; avgPrice: number | null } {
  const candidates = orders
    .filter(
      (o) =>
        o.side === otherSide(side) &&
        o.user_id !== userId &&
        restingQuantity(o) > 0 &&
        o.limit_price >= CONTRACT_CENTS - limitPrice
    )
    .sort(
      (a, b) =>
        b.limit_price - a.limit_price ||
        a.created_at.localeCompare(b.created_at)
    );

  let remaining = quantity;
  let filled = 0;
  let costCents = 0;

  for (const order of candidates) {
    if (remaining <= 0) break;
    const fillQty = Math.min(remaining, restingQuantity(order));
    const myPrice = CONTRACT_CENTS - order.limit_price;
    costCents += myPrice * fillQty;
    filled += fillQty;
    remaining -= fillQty;
  }

  return {
    filled,
    resting: remaining,
    avgPrice: filled > 0 ? Math.round(costCents / filled) : null,
  };
}

export type MarketPosition = {
  /** Contracts held on each side. Holding both is how an exit is expressed. */
  yes: number;
  no: number;
  /** yes - no. Zero means fully offset: P&L is locked in either way. */
  net: number;
  /** Total cents put at risk across all fills. */
  costCents: number;
  /** Average price paid per contract on each side, or null if none held. */
  avgYesPrice: number | null;
  avgNoPrice: number | null;
  hasPosition: boolean;
};

export function getPosition(fills: MarketFill[], userId: string): MarketPosition {
  let yes = 0;
  let no = 0;
  let yesCost = 0;
  let noCost = 0;

  for (const fill of fills) {
    if (fill.yes_user_id === userId) {
      yes += fill.quantity;
      yesCost += fill.yes_price * fill.quantity;
    }
    if (fill.no_user_id === userId) {
      no += fill.quantity;
      noCost += (CONTRACT_CENTS - fill.yes_price) * fill.quantity;
    }
  }

  return {
    yes,
    no,
    net: yes - no,
    costCents: yesCost + noCost,
    avgYesPrice: yes > 0 ? Math.round(yesCost / yes) : null,
    avgNoPrice: no > 0 ? Math.round(noCost / no) : null,
    hasPosition: yes > 0 || no > 0,
  };
}

/**
 * Profit in cents if the market resolves to `outcome`, for one user.
 *
 * Per fill the loser pays their own stake to the winner, so on a YES outcome a
 * YES holder gains the NO side's stake (100 - yes_price) per contract and a NO
 * holder loses exactly that. Holding both sides of offsetting fills nets out,
 * which is what makes "buy the other side" a real exit.
 *
 * The client-side mirror of the payout query in confirm_market_resolution.
 */
export function getOutcomePreview(
  fills: MarketFill[],
  userId: string,
  outcome: MarketSide
): { isParticipant: boolean; profitCents: number } {
  let profitCents = 0;
  let isParticipant = false;

  for (const fill of fills) {
    const isYesHolder = fill.yes_user_id === userId;
    const isNoHolder = fill.no_user_id === userId;
    if (!isYesHolder && !isNoHolder) continue;
    isParticipant = true;

    // The stake the losing side of this fill forfeits.
    const stakeCents =
      (outcome === "yes" ? CONTRACT_CENTS - fill.yes_price : fill.yes_price) *
      fill.quantity;
    const won = outcome === "yes" ? isYesHolder : isNoHolder;
    profitCents += won ? stakeCents : -stakeCents;
  }

  return { isParticipant, profitCents };
}

/** Resting orders belonging to one user, newest first. */
export function getMyOpenOrders<T extends MarketOrder>(orders: T[], userId: string): T[] {
  return orders
    .filter((o) => o.user_id === userId && restingQuantity(o) > 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * The market's traded-price history, one point per fill in order. `yes_price`
 * on a fill already *is* the yes-probability in percent (a contract settles
 * at 100c), so this is a direct relabeling plus a running volume total --
 * the source of truth for MarketOddsChart.
 */
export function getOddsHistory(fills: MarketFill[]): MarketOddsPoint[] {
  const sorted = [...fills].sort((a, b) => a.created_at.localeCompare(b.created_at));
  let cumulativeVolume = 0;

  return sorted.map((fill) => {
    cumulativeVolume += fill.quantity;
    return {
      timestamp: new Date(fill.created_at).getTime(),
      yesProbability: fill.yes_price,
      noProbability: CONTRACT_CENTS - fill.yes_price,
      volume: cumulativeVolume,
    };
  });
}

export type PositionHistory = {
  points: UserPositionPoint[];
  /** The net-long side as of the latest point, or null once/if fully offset. */
  side: MarketSide | null;
  /** Avg entry price for `side`, in probability-percent terms; null if flat. */
  referenceOdds: number | null;
};

/**
 * A user's position value/P&L marked-to-market at every fill from their
 * first trade onward. Every fill in the market moves `currentOdds` (it's the
 * whole book's price), but only the user's own fills change what they hold --
 * mirrors getPosition's cost-basis math, just sampled at each point in time
 * instead of collapsed to a single running total.
 */
export function getPositionHistory(fills: MarketFill[], userId: string): PositionHistory {
  const sorted = [...fills].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const firstIndex = sorted.findIndex((f) => f.yes_user_id === userId || f.no_user_id === userId);
  if (firstIndex === -1) return { points: [], side: null, referenceOdds: null };

  const relevant = sorted.slice(firstIndex);

  let yes = 0;
  let no = 0;
  let yesCost = 0;
  let noCost = 0;
  const points: UserPositionPoint[] = [];

  for (const fill of relevant) {
    if (fill.yes_user_id === userId) {
      yes += fill.quantity;
      yesCost += fill.yes_price * fill.quantity;
    }
    if (fill.no_user_id === userId) {
      no += fill.quantity;
      noCost += (CONTRACT_CENTS - fill.yes_price) * fill.quantity;
    }

    const currentOdds = fill.yes_price;
    const held = yes + no;
    const costCents = yesCost + noCost;
    const valueCents = yes * currentOdds + no * (CONTRACT_CENTS - currentOdds);

    points.push({
      timestamp: new Date(fill.created_at).getTime(),
      currentOdds,
      positionValue: centsToDollars(valueCents),
      averageEntryPrice: held > 0 ? centsToDollars(Math.round(costCents / held)) : 0,
      pnl: centsToDollars(valueCents - costCents),
    });
  }

  const net = yes - no;
  const side: MarketSide | null = net > 0 ? "yes" : net < 0 ? "no" : null;
  const avgYesPrice = yes > 0 ? Math.round(yesCost / yes) : null;
  const avgNoPrice = no > 0 ? Math.round(noCost / no) : null;
  const referenceOdds =
    side === "yes"
      ? avgYesPrice
      : side === "no" && avgNoPrice != null
      ? CONTRACT_CENTS - avgNoPrice
      : null;

  return { points, side, referenceOdds };
}

export { restingQuantity };
