export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      bets: {
        Row: {
          id: string;
          invite_code: string;
          title: string;
          description: string | null;
          side_a_label: string;
          side_b_label: string;
          min_wager: number | null;
          max_wager: number | null;
          currency: string;
          deadline: string | null;
          status: BetStatus;
          creator_id: string;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          invite_code?: string;
          title: string;
          description?: string | null;
          side_a_label?: string;
          side_b_label?: string;
          min_wager?: number | null;
          max_wager?: number | null;
          currency?: string;
          deadline?: string | null;
          status?: BetStatus;
          creator_id: string;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          invite_code?: string;
          title?: string;
          description?: string | null;
          side_a_label?: string;
          side_b_label?: string;
          min_wager?: number | null;
          max_wager?: number | null;
          currency?: string;
          deadline?: string | null;
          status?: BetStatus;
          creator_id?: string;
          created_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bets_creator_id_fkey";
            columns: ["creator_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      bet_participants: {
        Row: {
          id: string;
          bet_id: string;
          user_id: string;
          side: "a" | "b";
          amount: number;
          joined_at: string;
        };
        Insert: {
          id?: string;
          bet_id: string;
          user_id: string;
          side: "a" | "b";
          amount: number;
          joined_at?: string;
        };
        Update: {
          id?: string;
          bet_id?: string;
          user_id?: string;
          side?: "a" | "b";
          amount?: number;
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bet_participants_bet_id_fkey";
            columns: ["bet_id"];
            isOneToOne: false;
            referencedRelation: "bets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bet_participants_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      resolutions: {
        Row: {
          id: string;
          bet_id: string;
          proposed_by: string;
          proposed_winner_side: "a" | "b";
          confirmed_by: string | null;
          status: ResolutionStatus;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          bet_id: string;
          proposed_by: string;
          proposed_winner_side: "a" | "b";
          confirmed_by?: string | null;
          status?: ResolutionStatus;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          bet_id?: string;
          proposed_by?: string;
          proposed_winner_side?: "a" | "b";
          confirmed_by?: string | null;
          status?: ResolutionStatus;
          created_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "resolutions_bet_id_fkey";
            columns: ["bet_id"];
            isOneToOne: false;
            referencedRelation: "bets";
            referencedColumns: ["id"];
          }
        ];
      };
      markets: {
        Row: {
          id: string;
          invite_code: string;
          title: string;
          description: string | null;
          yes_label: string;
          no_label: string;
          currency: string;
          deadline: string | null;
          max_contracts: number | null;
          last_price: number | null;
          status: MarketStatus;
          creator_id: string;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          invite_code?: string;
          title: string;
          description?: string | null;
          yes_label?: string;
          no_label?: string;
          currency?: string;
          deadline?: string | null;
          max_contracts?: number | null;
          last_price?: number | null;
          status?: MarketStatus;
          creator_id: string;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          invite_code?: string;
          title?: string;
          description?: string | null;
          yes_label?: string;
          no_label?: string;
          currency?: string;
          deadline?: string | null;
          max_contracts?: number | null;
          last_price?: number | null;
          status?: MarketStatus;
          creator_id?: string;
          created_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "markets_creator_id_fkey";
            columns: ["creator_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      market_orders: {
        Row: {
          id: string;
          market_id: string;
          user_id: string;
          side: MarketSide;
          limit_price: number;
          quantity: number;
          filled_quantity: number;
          status: MarketOrderStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          market_id: string;
          user_id: string;
          side: MarketSide;
          limit_price: number;
          quantity: number;
          filled_quantity?: number;
          status?: MarketOrderStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          market_id?: string;
          user_id?: string;
          side?: MarketSide;
          limit_price?: number;
          quantity?: number;
          filled_quantity?: number;
          status?: MarketOrderStatus;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "market_orders_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "market_orders_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      market_fills: {
        Row: {
          id: string;
          market_id: string;
          yes_user_id: string;
          no_user_id: string;
          yes_price: number;
          quantity: number;
          yes_order_id: string | null;
          no_order_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          market_id: string;
          yes_user_id: string;
          no_user_id: string;
          yes_price: number;
          quantity: number;
          yes_order_id?: string | null;
          no_order_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          market_id?: string;
          yes_user_id?: string;
          no_user_id?: string;
          yes_price?: number;
          quantity?: number;
          yes_order_id?: string | null;
          no_order_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "market_fills_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "market_fills_yes_user_id_fkey";
            columns: ["yes_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "market_fills_no_user_id_fkey";
            columns: ["no_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      market_resolutions: {
        Row: {
          id: string;
          market_id: string;
          proposed_by: string;
          proposed_outcome: MarketSide;
          confirmed_by: string | null;
          status: ResolutionStatus;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          market_id: string;
          proposed_by: string;
          proposed_outcome: MarketSide;
          confirmed_by?: string | null;
          status?: ResolutionStatus;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          market_id?: string;
          proposed_by?: string;
          proposed_outcome?: MarketSide;
          confirmed_by?: string | null;
          status?: ResolutionStatus;
          created_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "market_resolutions_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          }
        ];
      };
      iou_ledger: {
        Row: {
          id: string;
          // Exactly one of bet_id / market_id is set (iou_ledger_source_chk).
          bet_id: string | null;
          market_id: string | null;
          creditor_id: string;
          debtor_id: string;
          amount: number;
          settled: boolean;
          settled_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          bet_id?: string | null;
          market_id?: string | null;
          creditor_id: string;
          debtor_id: string;
          amount: number;
          settled?: boolean;
          settled_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          bet_id?: string | null;
          market_id?: string | null;
          creditor_id?: string;
          debtor_id?: string;
          amount?: number;
          settled?: boolean;
          settled_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "iou_ledger_bet_id_fkey";
            columns: ["bet_id"];
            isOneToOne: false;
            referencedRelation: "bets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "iou_ledger_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          }
        ];
      };
      settlements: {
        Row: {
          id: string;
          from_user_id: string;
          to_user_id: string;
          amount: number;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          from_user_id: string;
          to_user_id: string;
          amount: number;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          from_user_id?: string;
          to_user_id?: string;
          amount?: number;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      confirm_resolution: {
        Args: { p_resolution_id: string; p_confirmer_id: string };
        Returns: undefined;
      };
      dispute_resolution: {
        Args: { p_resolution_id: string; p_disputer_id: string };
        Returns: undefined;
      };
      place_wager: {
        Args: {
          p_bet_id: string;
          p_user_id: string;
          p_side: "a" | "b";
          p_amount: number;
        };
        Returns: undefined;
      };
      place_market_order: {
        Args: {
          p_market_id: string;
          p_user_id: string;
          p_side: MarketSide;
          p_limit_price: number;
          p_quantity: number;
        };
        // RETURNS TABLE, so PostgREST hands back an array of one row.
        Returns: {
          filled_qty: number;
          resting_qty: number;
          avg_price_cents: number | null;
        }[];
      };
      cancel_market_order: {
        Args: { p_order_id: string; p_user_id: string };
        Returns: undefined;
      };
      lock_market: {
        Args: { p_market_id: string; p_user_id: string };
        Returns: undefined;
      };
      confirm_market_resolution: {
        Args: { p_resolution_id: string; p_confirmer_id: string };
        Returns: undefined;
      };
      dispute_market_resolution: {
        Args: { p_resolution_id: string; p_disputer_id: string };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type BetStatus =
  | "open"
  | "active"
  | "locked"
  | "resolving"
  | "resolved"
  | "cancelled"
  | "expired"
  | "stuck";

export type ResolutionStatus =
  | "pending"
  | "confirmed"
  | "disputed"
  | "superseded";

/**
 * Markets deliberately reuse the bet status vocabulary so BetStatusBadge and
 * the dashboard tab groupings work for both. The meanings shift slightly:
 * `open` = no fills yet, `active` = has traded, `locked` = trading halted.
 */
export type MarketStatus = BetStatus;

/** A contract side, and also the outcome a market resolves to. */
export type MarketSide = "yes" | "no";

export type MarketOrderStatus = "open" | "filled" | "cancelled";
