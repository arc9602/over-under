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
      bet_options: {
        Row: {
          id: string;
          bet_id: string;
          label: string;
          sort_order: number;
        };
        Insert: {
          id?: string;
          bet_id: string;
          label: string;
          sort_order: number;
        };
        Update: {
          id?: string;
          bet_id?: string;
          label?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "bet_options_bet_id_fkey";
            columns: ["bet_id"];
            isOneToOne: false;
            referencedRelation: "bets";
            referencedColumns: ["id"];
          }
        ];
      };
      bet_participants: {
        Row: {
          id: string;
          bet_id: string;
          user_id: string;
          side: "a" | "b" | null;
          option_id: string | null;
          amount: number;
          joined_at: string;
        };
        Insert: {
          id?: string;
          bet_id: string;
          user_id: string;
          side?: "a" | "b" | null;
          option_id?: string | null;
          amount: number;
          joined_at?: string;
        };
        Update: {
          id?: string;
          bet_id?: string;
          user_id?: string;
          side?: "a" | "b" | null;
          option_id?: string | null;
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
            foreignKeyName: "bet_participants_option_id_fkey";
            columns: ["option_id"];
            isOneToOne: false;
            referencedRelation: "bet_options";
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
          proposed_winner_side: "a" | "b" | null;
          proposed_winner_option_id: string | null;
          confirmed_by: string | null;
          status: ResolutionStatus;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          bet_id: string;
          proposed_by: string;
          proposed_winner_side?: "a" | "b" | null;
          proposed_winner_option_id?: string | null;
          confirmed_by?: string | null;
          status?: ResolutionStatus;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          bet_id?: string;
          proposed_by?: string;
          proposed_winner_side?: "a" | "b" | null;
          proposed_winner_option_id?: string | null;
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
          },
          {
            foreignKeyName: "resolutions_proposed_winner_option_id_fkey";
            columns: ["proposed_winner_option_id"];
            isOneToOne: false;
            referencedRelation: "bet_options";
            referencedColumns: ["id"];
          }
        ];
      };
      iou_ledger: {
        Row: {
          id: string;
          bet_id: string;
          creditor_id: string;
          debtor_id: string;
          amount: number;
          settled: boolean;
          settled_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          bet_id: string;
          creditor_id: string;
          debtor_id: string;
          amount: number;
          settled?: boolean;
          settled_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          bet_id?: string;
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
      create_bet_with_options: {
        Args: {
          p_title: string;
          p_description: string | null;
          p_option_labels: string[];
          p_min_wager: number | null;
          p_max_wager: number | null;
          p_deadline: string | null;
          p_creator_option_index?: number | null;
          p_creator_amount?: number | null;
        };
        Returns: string;
      };
      confirm_resolution: {
        Args: { p_resolution_id: string; p_confirmer_id: string };
        Returns: undefined;
      };
      confirm_option_resolution: {
        Args: { p_resolution_id: string };
        Returns: undefined;
      };
      dispute_resolution: {
        Args: { p_resolution_id: string; p_disputer_id: string };
        Returns: undefined;
      };
      dispute_option_resolution: {
        Args: { p_resolution_id: string };
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
      place_option_wager: {
        Args: {
          p_bet_id: string;
          p_option_id: string;
          p_amount: number;
        };
        Returns: undefined;
      };
      propose_option_resolution: {
        Args: {
          p_bet_id: string;
          p_option_id: string;
        };
        Returns: string;
      };
      propose_legacy_resolution: {
        Args: {
          p_bet_id: string;
          p_side: "a" | "b";
        };
        Returns: string;
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
