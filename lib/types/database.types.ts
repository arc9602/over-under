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
          stake: number;
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
          stake: number;
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
          stake?: number;
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
          joined_at: string;
        };
        Insert: {
          id?: string;
          bet_id: string;
          user_id: string;
          side: "a" | "b";
          joined_at?: string;
        };
        Update: {
          id?: string;
          bet_id?: string;
          user_id?: string;
          side?: "a" | "b";
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
      confirm_resolution: {
        Args: { p_resolution_id: string; p_confirmer_id: string };
        Returns: undefined;
      };
      dispute_resolution: {
        Args: { p_resolution_id: string; p_disputer_id: string };
        Returns: undefined;
      };
      create_bet_with_participant: {
        Args: {
          p_title: string;
          p_description: string | null;
          p_side_a_label: string;
          p_side_b_label: string;
          p_stake: number;
          p_deadline: string | null;
          p_creator_id: string;
        };
        Returns: { bet_id: string; invite_code: string }[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type BetStatus =
  | "open"
  | "active"
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
