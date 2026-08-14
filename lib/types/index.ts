import type { Database, BetStatus } from "./database.types";

export type {
  BetStatus,
  ResolutionStatus,
  MarketStatus,
  MarketSide,
  MarketOrderStatus,
  FriendRequestStatus,
  BetInviteStatus,
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
export type BetOption = Database["public"]["Tables"]["bet_options"]["Row"];
export type Resolution = Database["public"]["Tables"]["resolutions"]["Row"];
export type IouEntry = Database["public"]["Tables"]["iou_ledger"]["Row"];
export type Settlement = Database["public"]["Tables"]["settlements"]["Row"];
export type FriendRequest =
  Database["public"]["Tables"]["friend_requests"]["Row"];
export type Friendship = Database["public"]["Tables"]["friendships"]["Row"];
export type BetInvite = Database["public"]["Tables"]["bet_invites"]["Row"];

export type FriendRequestWithProfile = FriendRequest & {
  profile: Profile;
};

export type BetInviteWithDetails = BetInvite & {
  inviter: Profile;
  bet: Pick<Bet, "id" | "title" | "invite_code" | "status" | "deadline">;
};

export type BetWithParticipants = Bet & {
  creator: Profile;
  bet_participants: (BetParticipant & { profiles: Profile })[];
  bet_options: BetOption[];
};

export type BetWithDetails = Bet & {
  creator: Profile;
  bet_participants: (BetParticipant & { profiles: Profile })[];
  bet_options: BetOption[];
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
