import type {
  BetPoolPoint,
  MarketOddsPoint,
  MarketSide,
  UserBetPoolPoint,
  UserPositionPoint,
} from "@/lib/types";

/**
 * Test-only fixture generators for MarketOddsChart / BetPositionChart --
 * random-walk data so the charts can be exercised without a live market.
 * Not imported by any query/action; wire real data through
 * lib/utils/marketBook.ts#getOddsHistory / #getPositionHistory instead.
 */

function clampProbability(value: number): number {
  return Math.max(1, Math.min(99, value));
}

/** Deterministic PRNG (mulberry32) so a given seed always reproduces the same series. */
function mulberry32(seed: number) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MockOddsSeriesOptions {
  /** Number of trade ticks to generate. */
  points?: number;
  /** Total time span covered, ending now. */
  spanMs?: number;
  startProbability?: number;
  /** Max swing per tick, in probability points. */
  volatility?: number;
  seed?: number;
}

export function generateMockOddsSeries(options: MockOddsSeriesOptions = {}): MarketOddsPoint[] {
  const {
    points = 120,
    spanMs = 30 * 24 * 60 * 60 * 1000,
    startProbability = 50,
    volatility = 3,
    seed = 1,
  } = options;

  const rand = mulberry32(seed);
  const now = Date.now();
  const start = now - spanMs;

  let probability = startProbability;
  let cumulativeVolume = 0;
  const series: MarketOddsPoint[] = [];

  for (let i = 0; i < points; i++) {
    const timestamp = start + Math.round((i / Math.max(1, points - 1)) * spanMs);
    probability = clampProbability(probability + (rand() - 0.5) * volatility * 2);
    cumulativeVolume += Math.round(rand() * 20) + 1;

    const yesProbability = Math.round(probability);
    series.push({
      timestamp,
      yesProbability,
      noProbability: 100 - yesProbability,
      volume: cumulativeVolume,
    });
  }

  return series;
}

export interface MockPositionSeriesOptions {
  points?: number;
  spanMs?: number;
  side?: MarketSide;
  /** Entry price in cents (1-99). */
  entryPrice?: number;
  contracts?: number;
  volatility?: number;
  seed?: number;
}

export interface MockPositionSeries {
  points: UserPositionPoint[];
  referenceOdds: number;
  side: MarketSide;
}

export function generateMockPositionSeries(options: MockPositionSeriesOptions = {}): MockPositionSeries {
  const {
    points: count = 60,
    spanMs = 7 * 24 * 60 * 60 * 1000,
    side = "yes",
    entryPrice = 45,
    contracts = 50,
    volatility = 2.5,
    seed = 7,
  } = options;

  const rand = mulberry32(seed);
  const now = Date.now();
  const start = now - spanMs;
  const costCents = entryPrice * contracts;

  let odds = entryPrice;
  const series: UserPositionPoint[] = [];

  for (let i = 0; i < count; i++) {
    const timestamp = start + Math.round((i / Math.max(1, count - 1)) * spanMs);
    // Slight upward drift bias so the sample data trends into profit by default.
    odds = clampProbability(odds + (rand() - 0.48) * volatility * 2);
    const roundedOdds = Math.round(odds);

    const valueCents = side === "yes" ? contracts * roundedOdds : contracts * (100 - roundedOdds);

    series.push({
      timestamp,
      currentOdds: roundedOdds,
      positionValue: valueCents / 100,
      averageEntryPrice: entryPrice / 100,
      pnl: (valueCents - costCents) / 100,
    });
  }

  return { points: series, referenceOdds: entryPrice, side };
}

export interface MockPoolSeriesOptions {
  participantCount?: number;
  spanMs?: number;
  seed?: number;
  /** Chance each new participant lands on side A, 0-1. */
  sideABias?: number;
}

export function generateMockPoolSeries(options: MockPoolSeriesOptions = {}): BetPoolPoint[] {
  const {
    participantCount = 10,
    spanMs = 3 * 24 * 60 * 60 * 1000,
    seed = 5,
    sideABias = 0.55,
  } = options;

  const rand = mulberry32(seed);
  const now = Date.now();
  const start = now - spanMs;

  let aTotal = 0;
  let bTotal = 0;
  const points: BetPoolPoint[] = [];

  for (let i = 0; i < participantCount; i++) {
    const timestamp = start + Math.round((i / Math.max(1, participantCount - 1)) * spanMs);
    const side = rand() < sideABias ? "a" : "b";
    const amount = Math.round((10 + rand() * 90) * 100) / 100;
    if (side === "a") aTotal += amount;
    else bTotal += amount;

    const poolTotal = aTotal + bTotal;
    const sideAProbability = poolTotal > 0 ? Math.round((aTotal / poolTotal) * 100) : 50;

    points.push({
      timestamp,
      sideAProbability,
      sideBProbability: 100 - sideAProbability,
      poolTotal,
    });
  }

  return points;
}

export interface MockUserPoolSeriesOptions {
  participantCount?: number;
  spanMs?: number;
  seed?: number;
  side?: "a" | "b";
  wager?: number;
  /** 0-based index of the simulated participant list that is "you". */
  userJoinIndex?: number;
}

export interface MockUserPoolSeries {
  points: UserBetPoolPoint[];
  referenceOdds: number;
  side: "a" | "b";
}

export function generateMockUserPoolSeries(options: MockUserPoolSeriesOptions = {}): MockUserPoolSeries {
  const {
    participantCount = 8,
    spanMs = 3 * 24 * 60 * 60 * 1000,
    seed = 13,
    side = "a",
    wager = 50,
    userJoinIndex = 1,
  } = options;

  const rand = mulberry32(seed);
  const now = Date.now();
  const start = now - spanMs;

  let aTotal = 0;
  let bTotal = 0;
  let referenceOdds = 50;
  const points: UserBetPoolPoint[] = [];

  for (let i = 0; i < participantCount; i++) {
    const timestamp = start + Math.round((i / Math.max(1, participantCount - 1)) * spanMs);
    const isUser = i === userJoinIndex;
    const thisSide = isUser ? side : rand() < 0.5 ? "a" : "b";
    const amount = isUser ? wager : Math.round((10 + rand() * 90) * 100) / 100;

    if (thisSide === "a") aTotal += amount;
    else bTotal += amount;

    const poolTotal = aTotal + bTotal;
    const mySideTotal = side === "a" ? aTotal : bTotal;
    const otherTotal = side === "a" ? bTotal : aTotal;
    const currentOdds = poolTotal > 0 ? Math.round((mySideTotal / poolTotal) * 100) : 50;

    if (isUser) referenceOdds = currentOdds;
    if (i < userJoinIndex) continue;

    const profit = mySideTotal > 0 ? (wager / mySideTotal) * otherTotal : 0;
    const projectedPayout = wager + profit;

    points.push({
      timestamp,
      currentOdds,
      projectedPayout,
      wager,
      pnl: projectedPayout - wager,
    });
  }

  return { points, referenceOdds, side };
}
