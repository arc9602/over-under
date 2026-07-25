import type { Database, BetStatus } from "./database.types";

export type { BetStatus, ResolutionStatus } from "./database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Bet = Database["public"]["Tables"]["bets"]["Row"];
export type BetParticipant =
  Database["public"]["Tables"]["bet_participants"]["Row"];
export type Resolution = Database["public"]["Tables"]["resolutions"]["Row"];
export type IouEntry = Database["public"]["Tables"]["iou_ledger"]["Row"];
export type Settlement = Database["public"]["Tables"]["settlements"]["Row"];

export type BetWithParticipants = Bet & {
  bet_participants: (BetParticipant & { profiles: Profile })[];
};

export type BetWithDetails = Bet & {
  bet_participants: (BetParticipant & { profiles: Profile })[];
  resolutions: Resolution[];
};

export type NetBalance = {
  friend: Profile;
  netAmount: number; // positive = they owe you, negative = you owe them
  unsettledIous: IouEntry[];
};
