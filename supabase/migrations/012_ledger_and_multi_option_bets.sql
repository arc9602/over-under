BEGIN;

-- ============================================================
-- Double-entry ledger, additive alongside iou_ledger rather than replacing
-- it. iou_ledger stays exactly as-is and stays the thing /balances and
-- settle-up read -- nothing about the existing UI changes in this
-- migration. This adds an immutable, balanced record of the same events
-- going forward, dual-written via a trigger on iou_ledger's INSERT (so it
-- can never be forgotten by a future code path) plus an explicit call from
-- markSettled for payments, which don't correspond to a new iou_ledger row.
--
-- Once this has run in production for a while and looks correct, a later
-- migration can point the balance-computing queries at ledger_postings
-- directly and backfill iou_ledger's history into it. That cutover is
-- deliberately not part of this migration -- rewiring every balance read
-- path in the same change that introduces the ledger is how a live
-- financial app's numbers go quietly wrong with no fast way to tell.
-- ============================================================

CREATE TABLE public.ledger_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN ('bet_settlement', 'market_settlement', 'debt_payment')),
  -- Mirrors iou_ledger's own source tracking, but looser: a debt_payment
  -- isn't tied to one bet/market (a single payment can pay down debt
  -- accumulated across several), so both are allowed to be null -- just
  -- never both set at once.
  bet_id      UUID REFERENCES public.bets(id),
  market_id   UUID REFERENCES public.markets(id),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(bet_id, market_id) <= 1)
);

-- The actual double-entry lines. `amount` is signed from this user's own
-- point of view: positive means this posting increased what they're owed
-- (or decreased what they owe), negative the opposite -- same sign
-- convention lib/utils/portfolio.ts already uses when it reconstructs a
-- user's net position from iou_ledger by hand. Every transaction's postings
-- must sum to exactly zero; enforced below by a deferred constraint
-- trigger, since a plain CHECK can't see other rows.
CREATE TABLE public.ledger_postings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.ledger_transactions(id),
  user_id        UUID NOT NULL REFERENCES public.profiles(id),
  amount         NUMERIC(10,2) NOT NULL CHECK (amount <> 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ledger_postings_transaction_idx ON public.ledger_postings (transaction_id);
CREATE INDEX ledger_postings_user_idx ON public.ledger_postings (user_id, created_at);

-- ============================================================
-- Immutability: BEFORE UPDATE/DELETE triggers, not just "nothing in the app
-- happens to update these rows". Unlike RLS, a trigger fires regardless of
-- which role is doing the writing, so this holds even against the
-- service-role client every SECURITY DEFINER function in this app uses --
-- there is no path, including a future bug, that can rewrite ledger
-- history short of a migration explicitly dropping the trigger.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reject_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Ledger rows are immutable: % is not allowed on %', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER ledger_transactions_immutable
  BEFORE UPDATE OR DELETE ON public.ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION public.reject_ledger_mutation();

CREATE TRIGGER ledger_postings_immutable
  BEFORE UPDATE OR DELETE ON public.ledger_postings
  FOR EACH ROW EXECUTE FUNCTION public.reject_ledger_mutation();

-- ============================================================
-- Balance invariant: every transaction's postings must net to zero.
-- DEFERRABLE INITIALLY DEFERRED so it checks once at COMMIT (or an explicit
-- SET CONSTRAINTS ... IMMEDIATE), not after each individual posting row --
-- a transaction is written one posting at a time, so checking immediately
-- after the first row would always fail before the offsetting row exists.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_ledger_transaction_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_sum NUMERIC;
BEGIN
  SELECT SUM(amount) INTO v_sum
  FROM public.ledger_postings
  WHERE transaction_id = NEW.transaction_id;

  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'Ledger transaction % does not balance (postings sum to %)',
      NEW.transaction_id, v_sum;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_postings_balanced
  AFTER INSERT ON public.ledger_postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_ledger_transaction_balanced();

-- ============================================================
-- The one way anything is allowed to write to this ledger.
-- `p_increase_user_id` gets a positive posting, `p_decrease_user_id` gets
-- the same amount negative -- deliberately not named creditor/debtor, since
-- that framing flips for a payment (paying down what you owe *increases*
-- your own balance). Callers pick the direction that matches what actually
-- happened; the function just enforces that it balances and can't be
-- un-happened afterward.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_ledger_transaction(
  p_kind TEXT,
  p_bet_id UUID,
  p_market_id UUID,
  p_increase_user_id UUID,
  p_decrease_user_id UUID,
  p_amount NUMERIC,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_transaction_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Ledger transaction amount must be positive';
  END IF;
  IF p_increase_user_id = p_decrease_user_id THEN
    RAISE EXCEPTION 'A ledger transaction needs two different accounts';
  END IF;

  INSERT INTO public.ledger_transactions (kind, bet_id, market_id, description)
  VALUES (p_kind, p_bet_id, p_market_id, p_description)
  RETURNING id INTO v_transaction_id;

  INSERT INTO public.ledger_postings (transaction_id, user_id, amount)
  VALUES
    (v_transaction_id, p_increase_user_id, p_amount),
    (v_transaction_id, p_decrease_user_id, -p_amount);

  RETURN v_transaction_id;
END;
$$;

-- ============================================================
-- Dual-write from iou_ledger. Fires for every future INSERT regardless of
-- which function does it (confirm_resolution, confirm_market_resolution,
-- or anything added later), so this can't go stale the way a call
-- hand-wired into two specific functions could. iou_ledger.amount already
-- has a CHECK (amount > 0) constraint (migration 010), so any row that
-- reaches this trigger is already guaranteed positive.
-- ============================================================

CREATE OR REPLACE FUNCTION public.mirror_iou_to_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.record_ledger_transaction(
    CASE WHEN NEW.bet_id IS NOT NULL THEN 'bet_settlement' ELSE 'market_settlement' END,
    NEW.bet_id,
    NEW.market_id,
    NEW.creditor_id,
    NEW.debtor_id,
    NEW.amount
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER iou_ledger_mirror_to_double_entry
  AFTER INSERT ON public.iou_ledger
  FOR EACH ROW EXECUTE FUNCTION public.mirror_iou_to_ledger();

-- ============================================================
-- Read-only balance view. security_invoker is load-bearing, not decorative:
-- without it, a plain view runs with the view owner's privileges, which
-- bypasses ledger_postings' own RLS and would hand every authenticated
-- user everyone's balance in one query -- the exact class of gap the
-- rate_limit_events RLS fix closed, just reachable through a view instead
-- of the bare table this time.
-- ============================================================

CREATE VIEW public.ledger_balances
WITH (security_invoker = true) AS
SELECT user_id, SUM(amount) AS balance
FROM public.ledger_postings
GROUP BY user_id;

-- ============================================================
-- RLS: read-only for everyone, scoped to their own rows. All writes go
-- through record_ledger_transaction (SECURITY DEFINER) or the mirror
-- trigger, never direct inserts from anon/authenticated -- so there are no
-- INSERT/UPDATE/DELETE policies at all, matching iou_ledger's existing
-- "service role only writes" convention.
-- ============================================================

ALTER TABLE public.ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_postings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own postings"
  ON public.ledger_postings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read transactions they have a posting in"
  ON public.ledger_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.ledger_postings p
      WHERE p.transaction_id = ledger_transactions.id AND p.user_id = auth.uid()
    )
  );

-- ================================================================
-- Multi-option bets: a bet can now have more than two named choices.
-- Designed fresh against the current schema (not the abandoned
-- feature/multi-option-bets-v2 branch, which predates the auth/rate-limit/
-- ledger work above and touches functions that have since been rewritten
-- twice). Additive and backward-compatible by construction:
--
-- - bets.side_a_label/side_b_label, bet_participants.side, and
--   resolutions.proposed_winner_side all stay exactly as they are. Every
--   existing 2-option bet -- and every NEW bet created with exactly 2
--   options -- keeps going through place_wager / confirm_resolution /
--   dispute_resolution completely unmodified. Those functions already got
--   rewritten twice in this session (010, 011); a bet with only two options
--   has zero reason to touch them a third time.
-- - A new bet_options table is the option list for every bet, old and new.
--   A trigger backfills it automatically on every bets INSERT from
--   side_a_label/side_b_label, and this migration backfills it once for
--   every bet that already exists -- so bet_options is always populated,
--   uniformly, whether a bet has 2 options or 10.
-- - A bet with 3+ options is wagered on, proposed, and confirmed through a
--   parallel set of option_id-based functions (place_option_wager,
--   propose_option_resolution, confirm_option_resolution). dispute is NOT
--   duplicated: dispute_resolution's body never reads `side` at all, so it
--   already works unchanged for option-based resolutions too.
-- ================================================================

CREATE TABLE public.bet_options (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id     UUID NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  sort_order INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bet_id, sort_order)
);

CREATE INDEX bet_options_bet_idx ON public.bet_options (bet_id);

ALTER TABLE public.bet_options ENABLE ROW LEVEL SECURITY;

-- Same visibility rule as bets itself: creator, or anyone who's wagered.
CREATE POLICY "Participants can read bet options"
  ON public.bet_options FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bets b
      WHERE b.id = bet_options.bet_id
        AND (b.creator_id = auth.uid() OR public.is_bet_participant(b.id, auth.uid()))
    )
  );

-- Every bet, however it's created, ends up with bet_options rows: this
-- trigger creates options 0 and 1 from side_a_label/side_b_label on every
-- bets INSERT. create_bet_with_options (below) relies on this firing and
-- only adds options 2+ itself, so the two creation paths can't drift apart.
CREATE OR REPLACE FUNCTION public.create_legacy_bet_options()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.bet_options (bet_id, label, sort_order)
  VALUES (NEW.id, NEW.side_a_label, 0), (NEW.id, NEW.side_b_label, 1);
  RETURN NEW;
END;
$$;

CREATE TRIGGER bets_create_options_on_insert
  AFTER INSERT ON public.bets
  FOR EACH ROW EXECUTE FUNCTION public.create_legacy_bet_options();

-- Backfill for every bet that already exists.
INSERT INTO public.bet_options (bet_id, label, sort_order)
SELECT id, side_a_label, 0 FROM public.bets
UNION ALL
SELECT id, side_b_label, 1 FROM public.bets;

-- bet_participants.side and resolutions.proposed_winner_side both become
-- nullable: NULL means "this row belongs to a 3+-option bet, see option_id
-- instead", non-null means "unchanged legacy path". Dynamic constraint
-- drop/recreate matches the pattern 006_pooled_bets.sql already
-- established, rather than guessing at Postgres's auto-generated names.

ALTER TABLE public.bet_participants ADD COLUMN option_id UUID REFERENCES public.bet_options(id);
ALTER TABLE public.bet_participants ALTER COLUMN side DROP NOT NULL;

-- Pattern matches 006_pooled_bets.sql's own constraint drops, not a new
-- invention: match on the column name alone, not on "IN" appearing
-- literally in the definition. Postgres commonly rewrites `x IN (a, b)` to
-- `x = ANY (ARRAY[a, b])` when it renders a constraint back out, so a
-- pattern that assumes the literal keyword "IN" survives would silently
-- match nothing and never fire.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.bet_participants'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%side%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.bet_participants DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.bet_participants
  ADD CONSTRAINT bet_participants_side_chk CHECK (side IS NULL OR side IN ('a', 'b'));
-- Exactly one of side/option_id populated: a row is either the legacy
-- 2-option shape or the new option-based shape, never both, never neither.
ALTER TABLE public.bet_participants
  ADD CONSTRAINT bet_participants_side_xor_option_chk
  CHECK (num_nonnulls(side, option_id) = 1);

ALTER TABLE public.resolutions ADD COLUMN proposed_winner_option_id UUID REFERENCES public.bet_options(id);
ALTER TABLE public.resolutions ALTER COLUMN proposed_winner_side DROP NOT NULL;

DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.resolutions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%proposed_winner_side%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.resolutions DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.resolutions
  ADD CONSTRAINT resolutions_winner_side_chk
  CHECK (proposed_winner_side IS NULL OR proposed_winner_side IN ('a', 'b'));
ALTER TABLE public.resolutions
  ADD CONSTRAINT resolutions_winner_side_xor_option_chk
  CHECK (num_nonnulls(proposed_winner_side, proposed_winner_option_id) = 1);

-- ============================================================
-- place_wager gets one addition here: a guard against being called on a
-- bet that actually has 3+ options. Nothing else changes from 011 --
-- verified byte-for-byte against that version before this migration
-- shipped. Without this, calling the legacy function on a multi-option bet
-- would insert a side-only row (option_id NULL) that confirm_option_resolution
-- can't count on either side of a payout -- not a fund-safety issue (that
-- money still belongs to the person who staked it, and place_option_wager
-- is the only function that can create option-based rows for that bet), but
-- it would silently sit out of settlement, which is confusing and wrong.
-- The frontend routes to the correct function by option count; this is the
-- backstop for anything that calls place_wager directly.
-- ============================================================

CREATE OR REPLACE FUNCTION public.place_wager(
  p_bet_id UUID,
  p_user_id UUID,
  p_side TEXT,
  p_amount NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_min NUMERIC;
  v_max NUMERIC;
  v_existing_side TEXT;
  v_existing_amount NUMERIC;
  v_new_total NUMERIC;
BEGIN
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;
  IF p_side NOT IN ('a', 'b') THEN
    RAISE EXCEPTION 'Invalid side';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount';
  END IF;
  IF (SELECT COUNT(*) FROM public.bet_options WHERE bet_id = p_bet_id) > 2 THEN
    RAISE EXCEPTION 'This bet has more than two options -- wager through place_option_wager instead';
  END IF;
  IF NOT public.check_rate_limit(p_user_id, 'place_wager', 20, 60) THEN
    RAISE EXCEPTION 'Too many wagers placed -- wait a moment and try again';
  END IF;

  -- Lock the bet row so concurrent wagers (esp. the open->active flip) serialize.
  SELECT status, min_wager, max_wager INTO v_status, v_min, v_max
  FROM public.bets WHERE id = p_bet_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;
  IF v_status NOT IN ('open', 'active') THEN
    RAISE EXCEPTION 'This bet is no longer accepting wagers';
  END IF;

  SELECT side, amount INTO v_existing_side, v_existing_amount
  FROM public.bet_participants
  WHERE bet_id = p_bet_id AND user_id = p_user_id;

  IF FOUND AND v_existing_side <> p_side THEN
    RAISE EXCEPTION 'You already wagered on the other side of this bet';
  END IF;

  v_new_total := COALESCE(v_existing_amount, 0) + p_amount;

  IF v_min IS NOT NULL AND v_new_total < v_min THEN
    RAISE EXCEPTION 'Your total wager must be at least %', v_min;
  END IF;
  IF v_max IS NOT NULL AND v_new_total > v_max THEN
    RAISE EXCEPTION 'Your total wager can''t exceed %', v_max;
  END IF;

  IF FOUND THEN
    UPDATE public.bet_participants
    SET amount = v_new_total
    WHERE bet_id = p_bet_id AND user_id = p_user_id;
  ELSE
    INSERT INTO public.bet_participants (bet_id, user_id, side, amount)
    VALUES (p_bet_id, p_user_id, p_side, p_amount);
  END IF;

  IF v_status = 'open' THEN
    IF EXISTS (SELECT 1 FROM public.bet_participants WHERE bet_id = p_bet_id AND side = 'a')
       AND EXISTS (SELECT 1 FROM public.bet_participants WHERE bet_id = p_bet_id AND side = 'b') THEN
      UPDATE public.bets SET status = 'active' WHERE id = p_bet_id;
    END IF;
  END IF;
END;
$$;

-- ============================================================
-- Creates a bet with N options (N >= 2) in one shot. The first two labels
-- become side_a_label/side_b_label same as today, so legacy code reading
-- those two columns still sees something meaningful; the
-- bets_create_options_on_insert trigger turns those into bet_options 0/1
-- automatically, and this function only has to insert option 2 onward.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_bet_with_options(
  p_creator_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_option_labels TEXT[],
  p_min_wager NUMERIC,
  p_max_wager NUMERIC,
  p_deadline TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_bet_id UUID;
  v_label TEXT;
  v_sort_order INT := 1;
  v_option_count INT;
BEGIN
  IF p_creator_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;

  v_option_count := COALESCE(array_length(p_option_labels, 1), 0);
  IF v_option_count < 2 THEN
    RAISE EXCEPTION 'A bet needs at least 2 options';
  END IF;
  IF v_option_count > 10 THEN
    RAISE EXCEPTION 'A bet can have at most 10 options';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (SELECT trim(x) AS label FROM unnest(p_option_labels) x) t
    WHERE label = ''
  ) THEN
    RAISE EXCEPTION 'Option labels can''t be blank';
  END IF;
  IF v_option_count <> (
    SELECT COUNT(DISTINCT lower(trim(x))) FROM unnest(p_option_labels) x
  ) THEN
    RAISE EXCEPTION 'Option labels must be unique';
  END IF;

  INSERT INTO public.bets (
    title, description, side_a_label, side_b_label, min_wager, max_wager, deadline, creator_id
  ) VALUES (
    p_title, p_description, p_option_labels[1], p_option_labels[2],
    p_min_wager, p_max_wager, p_deadline, p_creator_id
  )
  RETURNING id INTO v_bet_id;
  -- bets_create_options_on_insert already created options 0 and 1 above;
  -- add option 2 onward here.

  IF v_option_count > 2 THEN
    FOREACH v_label IN ARRAY p_option_labels[3:v_option_count]
    LOOP
      v_sort_order := v_sort_order + 1;
      INSERT INTO public.bet_options (bet_id, label, sort_order)
      VALUES (v_bet_id, v_label, v_sort_order);
    END LOOP;
  END IF;

  RETURN v_bet_id;
END;
$$;

-- ============================================================
-- Wagering on a 3+-option bet. Parallels place_wager exactly (same locking,
-- same cumulative min/max semantics, same rate limit bucket so switching
-- between this and the legacy function can't be used to double a user's
-- effective request budget) but keys off option_id instead of side.
--
-- The <= 2 guard below is the mirror image of place_wager's > 2 guard: the
-- two functions partition on option count with no overlap, so it's not
-- just the frontend's routing choice keeping a bet's participants
-- consistently side-based or consistently option-based -- one participant
-- going through the "wrong" function for a given bet is rejected outright,
-- not just discouraged. Without this, one participant using place_wager
-- and another using place_option_wager on the very same 2-option bet would
-- split it: confirm_resolution would never see the option_id row, and
-- confirm_option_resolution would never see the side row.
-- ============================================================

CREATE OR REPLACE FUNCTION public.place_option_wager(
  p_bet_id UUID,
  p_user_id UUID,
  p_option_id UUID,
  p_amount NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_min NUMERIC;
  v_max NUMERIC;
  v_existing_option UUID;
  v_existing_amount NUMERIC;
  v_new_total NUMERIC;
BEGIN
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bet_options WHERE id = p_option_id AND bet_id = p_bet_id) THEN
    RAISE EXCEPTION 'That option does not belong to this bet';
  END IF;
  IF (SELECT COUNT(*) FROM public.bet_options WHERE bet_id = p_bet_id) <= 2 THEN
    RAISE EXCEPTION 'This bet has two or fewer options -- wager through place_wager instead';
  END IF;

  IF NOT public.check_rate_limit(p_user_id, 'place_wager', 20, 60) THEN
    RAISE EXCEPTION 'Too many wagers placed -- wait a moment and try again';
  END IF;

  SELECT status, min_wager, max_wager INTO v_status, v_min, v_max
  FROM public.bets WHERE id = p_bet_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;
  IF v_status NOT IN ('open', 'active') THEN
    RAISE EXCEPTION 'This bet is no longer accepting wagers';
  END IF;

  SELECT option_id, amount INTO v_existing_option, v_existing_amount
  FROM public.bet_participants
  WHERE bet_id = p_bet_id AND user_id = p_user_id;

  IF FOUND AND v_existing_option <> p_option_id THEN
    RAISE EXCEPTION 'You already wagered on a different option in this bet';
  END IF;

  v_new_total := COALESCE(v_existing_amount, 0) + p_amount;

  IF v_min IS NOT NULL AND v_new_total < v_min THEN
    RAISE EXCEPTION 'Your total wager must be at least %', v_min;
  END IF;
  IF v_max IS NOT NULL AND v_new_total > v_max THEN
    RAISE EXCEPTION 'Your total wager can''t exceed %', v_max;
  END IF;

  IF FOUND THEN
    UPDATE public.bet_participants
    SET amount = v_new_total
    WHERE bet_id = p_bet_id AND user_id = p_user_id;
  ELSE
    INSERT INTO public.bet_participants (bet_id, user_id, option_id, amount)
    VALUES (p_bet_id, p_user_id, p_option_id, p_amount);
  END IF;

  IF v_status = 'open' THEN
    -- Active once at least two distinct options have money on them.
    IF (SELECT COUNT(DISTINCT option_id) FROM public.bet_participants WHERE bet_id = p_bet_id) >= 2 THEN
      UPDATE public.bets SET status = 'active' WHERE id = p_bet_id;
    END IF;
  END IF;
END;
$$;

-- ============================================================
-- Propose / confirm for a 3+-option bet. dispute_resolution is reused
-- as-is (see the section header above) -- no dispute_option_resolution
-- exists because none is needed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.propose_option_resolution(
  p_bet_id UUID,
  p_proposer_id UUID,
  p_winner_option_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_resolution_id UUID;
BEGIN
  IF p_proposer_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bet_options WHERE id = p_winner_option_id AND bet_id = p_bet_id) THEN
    RAISE EXCEPTION 'That option does not belong to this bet';
  END IF;
  IF NOT public.is_bet_participant(p_bet_id, p_proposer_id) THEN
    RAISE EXCEPTION 'Only a participant in this bet can propose a resolution';
  END IF;

  SELECT status INTO v_status FROM public.bets WHERE id = p_bet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;
  IF v_status <> 'locked' THEN
    RAISE EXCEPTION 'Bet must be locked before proposing a resolution';
  END IF;

  INSERT INTO public.resolutions (bet_id, proposed_by, proposed_winner_option_id)
  VALUES (p_bet_id, p_proposer_id, p_winner_option_id)
  RETURNING id INTO v_resolution_id;

  UPDATE public.bets SET status = 'resolving' WHERE id = p_bet_id;

  RETURN v_resolution_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_option_resolution(
  p_resolution_id UUID,
  p_confirmer_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_bet_id UUID;
  v_winner_option_id UUID;
  v_proposed_by UUID;
  v_win_total NUMERIC;
  v_lose_total NUMERIC;
BEGIN
  IF p_confirmer_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;

  SELECT r.bet_id, r.proposed_winner_option_id, r.proposed_by
  INTO v_bet_id, v_winner_option_id, v_proposed_by
  FROM public.resolutions r
  WHERE r.id = p_resolution_id AND r.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolution not found or already resolved';
  END IF;
  IF v_winner_option_id IS NULL THEN
    RAISE EXCEPTION 'This resolution has no option winner -- it belongs to confirm_resolution instead';
  END IF;

  IF NOT public.is_bet_participant(v_bet_id, p_confirmer_id) THEN
    RAISE EXCEPTION 'Only a participant in this bet can confirm its resolution';
  END IF;
  IF p_confirmer_id = v_proposed_by THEN
    RAISE EXCEPTION 'The proposer cannot confirm their own resolution -- another participant must';
  END IF;

  UPDATE public.resolutions
  SET status = 'confirmed', confirmed_by = p_confirmer_id, resolved_at = NOW()
  WHERE id = p_resolution_id;

  UPDATE public.bets
  SET status = 'resolved', resolved_at = NOW()
  WHERE id = v_bet_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_win_total
  FROM public.bet_participants WHERE bet_id = v_bet_id AND option_id = v_winner_option_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_lose_total
  FROM public.bet_participants WHERE bet_id = v_bet_id AND option_id <> v_winner_option_id;

  IF v_win_total = 0 OR v_lose_total = 0 THEN
    RETURN;
  END IF;

  -- Unlike the legacy confirm_resolution this parallels, zero-amount pairs
  -- (a proportional share that rounds to exactly $0.00) are skipped rather
  -- than inserted -- iou_ledger's amount CHECK (migration 010) would reject
  -- a $0 row outright and abort the whole resolution.
  INSERT INTO public.iou_ledger (bet_id, creditor_id, debtor_id, amount)
  SELECT v_bet_id, w.user_id, l.user_id, pair.amount
  FROM public.bet_participants w
  JOIN public.bet_participants l ON l.bet_id = w.bet_id AND l.option_id <> w.option_id
  CROSS JOIN LATERAL (
    SELECT ROUND(l.amount * (w.amount / v_win_total), 2) AS amount
  ) pair
  WHERE w.bet_id = v_bet_id AND w.option_id = v_winner_option_id
    AND pair.amount > 0;
END;
$$;

COMMIT;
