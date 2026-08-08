import type { Database, BetStatus } from "./database.types";

export type {
  BetStatus,
  ResolutionStatus,
  MarketStatus,
  MarketSide,
  MarketOrderStatus,
} from "./database.types";

export type {
  Timeframe,
  MarketOddsPoint,
  UserPositionPoint,
  BetPoolPoint,
  UserBetPoolPoint,
} from "./charts";
export { TIMEFRAMES } from "./charts";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Bet = Database["public"]["Tables"]["bets"]["Row"];
export type BetParticipant =
  Database["public"]["Tables"]["bet_participants"]["Row"];
export type Resolution = Database["public"]["Tables"]["resolutions"]["Row"];
export type IouEntry = Database["public"]["Tables"]["iou_ledger"]["Row"];
export type Settlement = Database["public"]["Tables"]["settlements"]["Row"];

export type BetWithParticipants = Bet & {
  creator: Profile;
  bet_participants: (BetParticipant & { profiles: Profile })[];
};

export type BetWithDetails = Bet & {
  creator: Profile;
  bet_participants: (BetParticipant & { profiles: Profile })[];
  resolutions: Resolution[];
};

export type Market = Database["public"]["Tables"]["markets"]["Row"];
export type MarketOrder = Database["public"]["Tables"]["market_orders"]["Row"];
export type MarketFill = Database["public"]["Tables"]["market_fills"]["Row"];
export type MarketResolution =
  Database["public"]["Tables"]["market_resolutions"]["Row"];

/** An order joined to the trader's profile, as the order book renders it. */
export type MarketOrderWithProfile = MarketOrder & { profiles: Profile };
/** A fill joined to both counterparties' profiles. */
export type MarketFillWithProfiles = MarketFill & {
  yes_profile: Profile;
  no_profile: Profile;
};

export type MarketWithBook = Market & {
  creator: Profile;
  market_orders: MarketOrderWithProfile[];
  market_fills: MarketFillWithProfiles[];
};

export type MarketWithDetails = MarketWithBook & {
  market_resolutions: MarketResolution[];
};

export type NetBalance = {
  friend: Profile;
  netAmount: number; // positive = they owe you, negative = you owe them
  unsettledIous: IouEntry[];
};
