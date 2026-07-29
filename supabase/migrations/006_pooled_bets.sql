-- Pooled multi-participant bets: any number of people can wager individual
-- amounts on either side (was: exactly 1 participant per side, fixed
-- bet-wide stake). See conversation/plan for full design rationale.

-- ============================================================
-- 1. bets: wager limits + status expansion
-- ============================================================

ALTER TABLE public.bets ADD COLUMN min_wager NUMERIC(10,2);
ALTER TABLE public.bets ADD COLUMN max_wager NUMERIC(10,2);
ALTER TABLE public.bets ADD CONSTRAINT bets_wager_range_chk
  CHECK (min_wager IS NULL OR max_wager IS NULL OR min_wager <= max_wager);

-- Drop the status CHECK constraint dynamically (don't assume its
-- auto-generated name) so we can widen the allowed values.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.bets'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.bets DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.bets ADD CONSTRAINT bets_status_check
  CHECK (status IN ('open','active','locked','resolving','resolved','cancelled','expired','stuck'));

-- Data remap: today's 'active' means "exactly 2 participants, awaiting
-- resolution" (the old model's implicit lock). That's precisely the new
-- 'locked' state. 'active' is being redefined to mean "funded on both
-- sides, still accepting wagers" -- a state that couldn't previously exist.
UPDATE public.bets SET status = 'locked' WHERE status = 'active';

-- ============================================================
-- 2. bet_participants: per-wager amount, drop the one-per-side constraint
-- ============================================================

ALTER TABLE public.bet_participants ADD COLUMN amount NUMERIC(10,2);
UPDATE public.bet_participants bp
  SET amount = b.stake
  FROM public.bets b
  WHERE b.id = bp.bet_id;
ALTER TABLE public.bet_participants ALTER COLUMN amount SET NOT NULL;
ALTER TABLE public.bet_participants ADD CONSTRAINT bet_participants_amount_chk CHECK (amount > 0);

-- Drop the UNIQUE(bet_id, side) constraint dynamically -- this is THE
-- constraint this whole change exists to remove. UNIQUE(bet_id, user_id) is
-- kept as-is: one participant row per user per bet; side-switching is
-- rejected at the RPC level, same-side top-ups increment the existing row.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.bet_participants'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE '%bet_id%side%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.bet_participants DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

-- ============================================================
-- 3. bets.stake removed now that amount lives per-participant
-- ============================================================

ALTER TABLE public.bets DROP COLUMN stake;

-- ============================================================
-- 4. RLS tightening
-- ============================================================

-- bet_participants writes become RPC-only (place_wager, SECURITY DEFINER
-- below), matching the existing convention for iou_ledger (no direct write
-- policy at all). A direct-insert policy can't enforce min/max, one-side-only,
-- or status gating, so it's removed entirely.
DROP POLICY IF EXISTS "Users can insert their own participation" ON public.bet_participants;

-- bets UPDATE was previously "any participant" -- looser than the app ever
-- actually needed (lock/cancel are creator-only operations). Tighten to match.
DROP POLICY IF EXISTS "Participants can update bets" ON public.bets;
CREATE POLICY "Creator can update bets"
  ON public.bets FOR UPDATE
  USING (auth.uid() = creator_id);

-- ============================================================
-- 5. Functions
-- ============================================================

-- create_bet_with_participant is removed: bet creation no longer needs
-- cross-table atomicity since the creator's own wager is now optional and
-- goes through the same place_wager path as everyone else.
DROP FUNCTION IF EXISTS public.create_bet_with_participant(TEXT, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ, UUID);

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
BEGIN
  IF p_side NOT IN ('a', 'b') THEN
    RAISE EXCEPTION 'Invalid side';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount';
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
  IF v_min IS NOT NULL AND p_amount < v_min THEN
    RAISE EXCEPTION 'Below minimum wager of %', v_min;
  END IF;
  IF v_max IS NOT NULL AND p_amount > v_max THEN
    RAISE EXCEPTION 'Above maximum wager of %', v_max;
  END IF;

  SELECT side INTO v_existing_side
  FROM public.bet_participants
  WHERE bet_id = p_bet_id AND user_id = p_user_id;

  IF FOUND THEN
    IF v_existing_side <> p_side THEN
      RAISE EXCEPTION 'You already wagered on the other side of this bet';
    END IF;
    UPDATE public.bet_participants
    SET amount = amount + p_amount
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

-- Pari-mutuel payout: each loser's stake is distributed across winners
-- proportional to the winners' relative stake. For a fixed loser, summing
-- across all winners recovers exactly their full stake; for a fixed winner,
-- summing across all losers gives exactly their proportional share of the
-- losing pool. Degrades to today's single-row behavior for 1-vs-1.
CREATE OR REPLACE FUNCTION public.confirm_resolution(
  p_resolution_id UUID,
  p_confirmer_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bet_id UUID;
  v_winner_side TEXT;
  v_win_total NUMERIC;
  v_lose_total NUMERIC;
BEGIN
  SELECT r.bet_id, r.proposed_winner_side
  INTO v_bet_id, v_winner_side
  FROM public.resolutions r
  WHERE r.id = p_resolution_id AND r.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolution not found or already resolved';
  END IF;

  UPDATE public.resolutions
  SET status = 'confirmed', confirmed_by = p_confirmer_id, resolved_at = NOW()
  WHERE id = p_resolution_id;

  UPDATE public.bets
  SET status = 'resolved', resolved_at = NOW()
  WHERE id = v_bet_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_win_total
  FROM public.bet_participants WHERE bet_id = v_bet_id AND side = v_winner_side;
  SELECT COALESCE(SUM(amount), 0) INTO v_lose_total
  FROM public.bet_participants WHERE bet_id = v_bet_id AND side <> v_winner_side;

  IF v_win_total = 0 OR v_lose_total = 0 THEN
    RETURN;
  END IF;

  -- NUMERIC(10,2) rounding per row means cent-level drift can accumulate
  -- across many rows -- acceptable for this informal IOU tracker.
  INSERT INTO public.iou_ledger (bet_id, creditor_id, debtor_id, amount)
  SELECT v_bet_id, w.user_id, l.user_id, ROUND(l.amount * (w.amount / v_win_total), 2)
  FROM public.bet_participants w
  JOIN public.bet_participants l ON l.bet_id = w.bet_id AND l.side <> w.side
  WHERE w.bet_id = v_bet_id AND w.side = v_winner_side;
END;
$$;

-- Dispute target changes from 'active' to 'locked' -- the reset target is
-- the "awaiting resolution" state, which is now named locked.
CREATE OR REPLACE FUNCTION public.dispute_resolution(
  p_resolution_id UUID,
  p_disputer_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bet_id UUID;
  v_dispute_count INT;
BEGIN
  SELECT r.bet_id INTO v_bet_id
  FROM public.resolutions r
  WHERE r.id = p_resolution_id AND r.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolution not found or not pending';
  END IF;

  UPDATE public.resolutions
  SET status = 'disputed', resolved_at = NOW()
  WHERE id = p_resolution_id;

  SELECT COUNT(*) INTO v_dispute_count
  FROM public.resolutions
  WHERE bet_id = v_bet_id AND status = 'disputed';

  IF v_dispute_count >= 3 THEN
    UPDATE public.bets SET status = 'stuck' WHERE id = v_bet_id;
  ELSE
    UPDATE public.bets SET status = 'locked' WHERE id = v_bet_id;
  END IF;
END;
$$;
