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
      friend_requests: {
        Row: {
          id: string;
          requester_id: string;
          recipient_id: string;
          status: FriendRequestStatus;
          created_at: string;
          responded_at: string | null;
        };
        Insert: {
          id?: string;
          requester_id: string;
          recipient_id: string;
          status?: FriendRequestStatus;
          created_at?: string;
          responded_at?: string | null;
        };
        Update: {
          id?: string;
          requester_id?: string;
          recipient_id?: string;
          status?: FriendRequestStatus;
          created_at?: string;
          responded_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "friend_requests_requester_id_fkey";
            columns: ["requester_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "friend_requests_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      friendships: {
        Row: {
          user_low_id: string;
          user_high_id: string;
          request_id: string | null;
          created_at: string;
        };
        Insert: {
          user_low_id: string;
          user_high_id: string;
          request_id?: string | null;
          created_at?: string;
        };
        Update: {
          user_low_id?: string;
          user_high_id?: string;
          request_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "friendships_user_low_id_fkey";
            columns: ["user_low_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "friendships_user_high_id_fkey";
            columns: ["user_high_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "friendships_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: true;
            referencedRelation: "friend_requests";
            referencedColumns: ["id"];
          }
        ];
      };
      bet_invites: {
        Row: {
          id: string;
          bet_id: string;
          inviter_id: string;
          invitee_id: string;
          status: BetInviteStatus;
          created_at: string;
          opened_at: string | null;
        };
        Insert: {
          id?: string;
          bet_id: string;
          inviter_id: string;
          invitee_id: string;
          status?: BetInviteStatus;
          created_at?: string;
          opened_at?: string | null;
        };
        Update: {
          id?: string;
          bet_id?: string;
          inviter_id?: string;
          invitee_id?: string;
          status?: BetInviteStatus;
          created_at?: string;
          opened_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bet_invites_bet_id_fkey";
            columns: ["bet_id"];
            isOneToOne: false;
            referencedRelation: "bets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bet_invites_inviter_id_fkey";
            columns: ["inviter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bet_invites_invitee_id_fkey";
            columns: ["invitee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
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
            foreignKeyName: "bet_participants_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bet_participants_option_id_fkey";
            columns: ["option_id"];
            isOneToOne: false;
            referencedRelation: "bet_options";
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
          created_at: string;
        };
        Insert: {
          id?: string;
          bet_id: string;
          label: string;
          sort_order: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          bet_id?: string;
          label?: string;
          sort_order?: number;
          created_at?: string;
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
          backing: string;
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
          backing?: string;
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
          backing?: string;
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
      wallet_links: {
        Row: {
          user_id: string;
          // Always lowercased; the CHECK enforces ^0x[0-9a-f]{40}$ so the
          // deposit/withdrawal equality checks can't be beaten by checksum casing.
          address: string;
          wallet_type: WalletType | null;
          verified_at: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          address: string;
          wallet_type?: WalletType | null;
          verified_at?: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          address?: string;
          wallet_type?: WalletType | null;
          verified_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wallet_links_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      usdc_accounts: {
        Row: {
          user_id: string;
          /**
           * Every NUMERIC(20,6) USDC column in this file is typed `string`, not
           * `number` — deliberately, and unlike what the Supabase CLI would
           * generate. These are money at 6 on-chain decimals, and
           * lib/chain/amount.ts is the only sanctioned way to handle them: it
           * takes decimal strings and returns bigint. Typing them as `number`
           * would let `balance * 2` or `a - b` compile cleanly and put IEEE-754
           * floats in the middle of a custodied balance, which is the exact bug
           * the whole design exists to prevent.
           */
          available: string;
          escrow: string;
          withdrawal_pending: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          available?: string;
          escrow?: string;
          withdrawal_pending?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          available?: string;
          escrow?: string;
          withdrawal_pending?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usdc_accounts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      usdc_transactions: {
        Row: {
          id: string;
          kind: UsdcTransactionKind;
          // At most one of bet_id / market_id is set — both NULL is legal here
          // (deposits and withdrawals belong to neither).
          bet_id: string | null;
          market_id: string | null;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          kind: UsdcTransactionKind;
          bet_id?: string | null;
          market_id?: string | null;
          description?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          kind?: UsdcTransactionKind;
          bet_id?: string | null;
          market_id?: string | null;
          description?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usdc_transactions_bet_id_fkey";
            columns: ["bet_id"];
            isOneToOne: false;
            referencedRelation: "bets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usdc_transactions_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          }
        ];
      };
      usdc_postings: {
        Row: {
          id: string;
          transaction_id: string;
          // NULL for exactly one bucket, 'external', which models the chain and
          // belongs to no user (usdc_postings_external_has_no_user_chk).
          user_id: string | null;
          bucket: UsdcBucket;
          // Signed: positive increased the bucket, negative decreased it. Never 0.
          amount: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          transaction_id: string;
          user_id?: string | null;
          bucket: UsdcBucket;
          amount: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          transaction_id?: string;
          user_id?: string | null;
          bucket?: UsdcBucket;
          amount?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usdc_postings_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "usdc_transactions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usdc_postings_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      usdc_deposits: {
        Row: {
          id: string;
          user_id: string;
          transaction_hash: string;
          from_address: string;
          amount: string;
          block_number: number | null;
          transaction_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          transaction_hash: string;
          from_address: string;
          amount: string;
          block_number?: number | null;
          transaction_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          transaction_hash?: string;
          from_address?: string;
          amount?: string;
          block_number?: number | null;
          transaction_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usdc_deposits_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usdc_deposits_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "usdc_transactions";
            referencedColumns: ["id"];
          }
        ];
      };
      usdc_withdrawals: {
        Row: {
          id: string;
          user_id: string;
          // Snapshotted from wallet_links at begin time, never read from the
          // request, so a mid-flight re-link cannot redirect the payout.
          to_address: string;
          amount: string;
          status: UsdcWithdrawalStatus;
          transaction_hash: string | null;
          failure_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          to_address: string;
          amount: string;
          status?: UsdcWithdrawalStatus;
          transaction_hash?: string | null;
          failure_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          to_address?: string;
          amount?: string;
          status?: UsdcWithdrawalStatus;
          transaction_hash?: string | null;
          failure_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usdc_withdrawals_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      usdc_escrow_locks: {
        Row: {
          id: string;
          user_id: string;
          // Exactly one of market_id / bet_id is set. order_id is independent:
          // it is set only when the lock came from a market order.
          market_id: string | null;
          order_id: string | null;
          bet_id: string | null;
          amount: string;
          status: UsdcEscrowLockStatus;
          created_at: string;
          released_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          market_id?: string | null;
          order_id?: string | null;
          bet_id?: string | null;
          amount: string;
          status?: UsdcEscrowLockStatus;
          created_at?: string;
          released_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          market_id?: string | null;
          order_id?: string | null;
          bet_id?: string | null;
          amount?: string;
          status?: UsdcEscrowLockStatus;
          created_at?: string;
          released_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "usdc_escrow_locks_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usdc_escrow_locks_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usdc_escrow_locks_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "market_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usdc_escrow_locks_bet_id_fkey";
            columns: ["bet_id"];
            isOneToOne: false;
            referencedRelation: "bets";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      send_friend_request: {
        Args: { p_recipient_id: string };
        Returns: string;
      };
      respond_friend_request: {
        Args: { p_request_id: string; p_accept: boolean };
        Returns: undefined;
      };
      cancel_friend_request: {
        Args: { p_request_id: string };
        Returns: undefined;
      };
      delete_bet: {
        // Migration 018. Returns the deleted bet's id so a caller can
        // confirm the RPC actually removed a row rather than trusting a
        // null error alone.
        Args: { p_bet_id: string };
        Returns: string;
      };
      remove_friend: {
        Args: { p_friend_id: string };
        Returns: undefined;
      };
      invite_friend_to_bet: {
        Args: { p_bet_id: string; p_invitee_id: string };
        Returns: string;
      };
      update_bet_invite: {
        Args: { p_invite_id: string; p_action: "seen" | "declined" };
        Returns: undefined;
      };
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
      create_bet_with_options: {
        Args: {
          p_creator_id: string;
          p_title: string;
          p_description: string | null;
          p_option_labels: string[];
          p_min_wager: number | null;
          p_max_wager: number | null;
          p_deadline: string | null;
        };
        Returns: string;
      };
      place_option_wager: {
        Args: {
          p_bet_id: string;
          p_user_id: string;
          p_option_id: string;
          p_amount: number;
        };
        Returns: undefined;
      };
      propose_option_resolution: {
        Args: {
          p_bet_id: string;
          p_proposer_id: string;
          p_winner_option_id: string;
        };
        Returns: string;
      };
      confirm_option_resolution: {
        Args: { p_resolution_id: string; p_confirmer_id: string };
        Returns: undefined;
      };
      place_market_order: {
        Args: {
          p_market_id: string;
          p_user_id: string;
          p_side: MarketSide;
          p_limit_price: number;
          p_quantity: number;
          p_escrow_lock_id?: string;
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
      check_rate_limit: {
        Args: {
          p_user_id: string;
          p_action: string;
          p_max_count: number;
          p_window_seconds: number;
        };
        Returns: boolean;
      };
      record_ledger_transaction: {
        Args: {
          p_kind: "bet_settlement" | "market_settlement" | "debt_payment";
          p_bet_id: string | null;
          p_market_id: string | null;
          p_increase_user_id: string;
          p_decrease_user_id: string;
          p_amount: number;
          p_description?: string | null;
        };
        Returns: string;
      };
      // The one primitive every USDC movement goes through. p_from_user_id and
      // p_to_user_id are NULL exactly when the corresponding bucket is
      // 'external' (the chain), which belongs to no user.
      move_usdc: {
        Args: {
          p_kind: UsdcTransactionKind;
          p_from_user_id: string | null;
          p_from_bucket: UsdcBucket;
          p_to_user_id: string | null;
          p_to_bucket: UsdcBucket;
          p_amount: string;
          p_bet_id?: string | null;
          p_market_id?: string | null;
          p_description?: string | null;
        };
        // The usdc_transactions id.
        Returns: string;
      };
      credit_usdc_deposit: {
        Args: {
          p_user_id: string;
          p_transaction_hash: string;
          p_from_address: string;
          p_amount: string;
          p_block_number?: number | null;
        };
        // The usdc_deposits id.
        Returns: string;
      };
      lock_usdc_escrow: {
        Args: {
          p_user_id: string;
          p_amount: string;
          p_market_id?: string | null;
          p_order_id?: string | null;
          p_bet_id?: string | null;
        };
        // The usdc_escrow_locks id.
        Returns: string;
      };
      release_usdc_escrow: {
        Args: { p_lock_id: string };
        Returns: undefined;
      };
      payout_usdc_escrow: {
        Args: {
          p_from_user_id: string;
          p_to_user_id: string;
          p_amount: string;
          p_market_id?: string | null;
          p_bet_id?: string | null;
          p_description?: string | null;
        };
        // The usdc_transactions id.
        Returns: string;
      };
      // RETURNS public.usdc_withdrawals, so the whole freshly-inserted row
      // comes back — the caller needs its id and to_address to do the send.
      begin_usdc_withdrawal: {
        Args: { p_user_id: string; p_amount: string };
        Returns: Database["public"]["Tables"]["usdc_withdrawals"]["Row"];
      };
      mark_usdc_withdrawal_sent: {
        Args: { p_withdrawal_id: string; p_transaction_hash: string };
        Returns: undefined;
      };
      finalize_usdc_withdrawal: {
        Args: { p_withdrawal_id: string };
        Returns: undefined;
      };
      revert_usdc_withdrawal: {
        Args: { p_withdrawal_id: string; p_reason?: string | null };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type FriendRequestStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled";

export type BetInviteStatus = "pending" | "seen" | "declined";

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

/** Which Privy wallet a `wallet_links` row describes. Display only. */
export type WalletType = "embedded" | "external";

/**
 * The four buckets USDC can sit in. The first three belong to a user and are
 * columns on `usdc_accounts`; `external` is the chain itself, belongs to
 * nobody, and exists so every event — deposit, escrow lock, payout,
 * withdrawal — is the same balanced two-sided transfer.
 */
export type UsdcBucket =
  | "available"
  | "escrow"
  | "withdrawal_pending"
  | "external";

/** What a `usdc_transactions` row was for. */
export type UsdcTransactionKind =
  | "deposit"
  | "escrow_lock"
  | "escrow_release"
  | "escrow_payout"
  | "withdrawal_begin"
  | "withdrawal_finalize"
  | "withdrawal_revert";

/**
 * Withdrawals are three-phase because signing and broadcasting can't happen
 * inside a database transaction: `pending` (funds moved to
 * withdrawal_pending), `sent` (broadcast, hash recorded), then either
 * `confirmed` (finalized to external) or `failed` (reverted to available).
 */
export type UsdcWithdrawalStatus = "pending" | "sent" | "confirmed" | "failed";

/**
 * `released` covers both endings — cancelled back to available, or paid out at
 * settlement. `usdc_transactions.kind` is what distinguishes them.
 */
export type UsdcEscrowLockStatus = "open" | "released";
