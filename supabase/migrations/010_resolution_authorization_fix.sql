BEGIN;

-- SECURITY DEFINER functions bypass RLS by design -- that's what lets them
-- write across bets/resolutions/iou_ledger (or markets/market_resolutions)
-- atomically. But bypassing RLS means the function itself is the entire
-- authorization boundary, and confirm_resolution / dispute_resolution /
-- confirm_market_resolution / dispute_market_resolution never checked that
-- the caller was a participant, or that they weren't confirming their own
-- proposal. Today: propose yourself as winner, then confirm your own
-- proposal, and the IOU writes with no agreement from anyone else.
--
-- Fixed by reusing the same participant helpers that already gate proposing
-- a resolution under RLS (is_bet_participant / can_access_market), plus an
-- explicit self-confirmation check mirroring the ownership check
-- cancel_market_order already does (`v_owner <> p_user_id`).

CREATE OR REPLACE FUNCTION public.confirm_resolution(
  p_resolution_id UUID,
  p_confirmer_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_bet_id UUID;
  v_winner_side TEXT;
  v_proposed_by UUID;
  v_win_total NUMERIC;
  v_lose_total NUMERIC;
BEGIN
  SELECT r.bet_id, r.proposed_winner_side, r.proposed_by
  INTO v_bet_id, v_winner_side, v_proposed_by
  FROM public.resolutions r
  WHERE r.id = p_resolution_id AND r.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolution not found or already resolved';
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
  FROM public.bet_participants WHERE bet_id = v_bet_id AND side = v_winner_side;
  SELECT COALESCE(SUM(amount), 0) INTO v_lose_total
  FROM public.bet_participants WHERE bet_id = v_bet_id AND side <> v_winner_side;

  IF v_win_total = 0 OR v_lose_total = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.iou_ledger (bet_id, creditor_id, debtor_id, amount)
  SELECT v_bet_id, w.user_id, l.user_id, ROUND(l.amount * (w.amount / v_win_total), 2)
  FROM public.bet_participants w
  JOIN public.bet_participants l ON l.bet_id = w.bet_id AND l.side <> w.side
  WHERE w.bet_id = v_bet_id AND w.side = v_winner_side;
END;
$$;

CREATE OR REPLACE FUNCTION public.dispute_resolution(
  p_resolution_id UUID,
  p_disputer_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
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

  -- Unlike confirm, a proposer disputing their own proposal is a legitimate
  -- self-correction (they realize the winner they proposed was wrong) and
  -- disputing moves no money -- it only reverts status. So only participant
  -- membership is checked here, not who proposed it.
  IF NOT public.is_bet_participant(v_bet_id, p_disputer_id) THEN
    RAISE EXCEPTION 'Only a participant in this bet can dispute its resolution';
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

CREATE OR REPLACE FUNCTION public.confirm_market_resolution(
  p_resolution_id UUID,
  p_confirmer_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_market_id UUID;
  v_outcome TEXT;
  v_proposed_by UUID;
BEGIN
  SELECT r.market_id, r.proposed_outcome, r.proposed_by
  INTO v_market_id, v_outcome, v_proposed_by
  FROM public.market_resolutions r
  WHERE r.id = p_resolution_id AND r.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolution not found or already resolved';
  END IF;

  IF NOT public.can_access_market(v_market_id, p_confirmer_id) THEN
    RAISE EXCEPTION 'Only a trader in this market can confirm its resolution';
  END IF;

  IF p_confirmer_id = v_proposed_by THEN
    RAISE EXCEPTION 'The proposer cannot confirm their own resolution -- another trader must';
  END IF;

  UPDATE public.market_resolutions
  SET status = 'confirmed', confirmed_by = p_confirmer_id, resolved_at = NOW()
  WHERE id = p_resolution_id;

  UPDATE public.markets
  SET status = 'resolved', resolved_at = NOW()
  WHERE id = v_market_id;

  INSERT INTO public.iou_ledger (market_id, creditor_id, debtor_id, amount)
  SELECT v_market_id, f.creditor_id, f.debtor_id, ROUND(SUM(f.cents)::NUMERIC / 100, 2)
  FROM (
    SELECT
      CASE WHEN v_outcome = 'yes' THEN mf.yes_user_id ELSE mf.no_user_id END AS creditor_id,
      CASE WHEN v_outcome = 'yes' THEN mf.no_user_id  ELSE mf.yes_user_id END AS debtor_id,
      (CASE WHEN v_outcome = 'yes' THEN 100 - mf.yes_price ELSE mf.yes_price END) * mf.quantity AS cents
    FROM public.market_fills mf
    WHERE mf.market_id = v_market_id
  ) f
  GROUP BY f.creditor_id, f.debtor_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.dispute_market_resolution(
  p_resolution_id UUID,
  p_disputer_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_market_id UUID;
  v_dispute_count INT;
BEGIN
  SELECT r.market_id INTO v_market_id
  FROM public.market_resolutions r
  WHERE r.id = p_resolution_id AND r.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolution not found or not pending';
  END IF;

  -- Same reasoning as dispute_resolution: self-dispute is a legitimate
  -- retraction and moves no money, so only membership is checked.
  IF NOT public.can_access_market(v_market_id, p_disputer_id) THEN
    RAISE EXCEPTION 'Only a trader in this market can dispute its resolution';
  END IF;

  UPDATE public.market_resolutions
  SET status = 'disputed', resolved_at = NOW()
  WHERE id = p_resolution_id;

  SELECT COUNT(*) INTO v_dispute_count
  FROM public.market_resolutions
  WHERE market_id = v_market_id AND status = 'disputed';

  IF v_dispute_count >= 3 THEN
    UPDATE public.markets SET status = 'stuck' WHERE id = v_market_id;
  ELSE
    UPDATE public.markets SET status = 'locked' WHERE id = v_market_id;
  END IF;
END;
$$;

-- ============================================================
-- Cheap defense-in-depth: reject non-positive amounts at the DB layer too,
-- not just in application Zod schemas.
--
-- Added NOT VALID: a plain ADD CONSTRAINT scans and validates every existing
-- row as part of this transaction, and confirm_resolution's per-row
-- ROUND(share, 2) can legitimately land on $0.00 for a very small
-- proportional stake -- a row this migration has no way to inspect ahead of
-- time. NOT VALID enforces the constraint on every INSERT/UPDATE from this
-- point forward without touching history, so it can't fail this migration
-- on data we haven't seen. Run the verification query below after this
-- commits; if it returns zero rows, VALIDATE CONSTRAINT any time afterward
-- (that scan takes only a SHARE UPDATE EXCLUSIVE lock, not a rewrite, so
-- it's safe to run live).
-- ============================================================

ALTER TABLE public.iou_ledger
  ADD CONSTRAINT iou_ledger_amount_positive_chk CHECK (amount > 0) NOT VALID;

ALTER TABLE public.settlements
  ADD CONSTRAINT settlements_amount_positive_chk CHECK (amount > 0) NOT VALID;

COMMIT;

-- ============================================================
-- Run after COMMIT, not inside the transaction above.
-- ============================================================

-- Both counts must be 0 before validating the constraints below.
-- SELECT COUNT(*) AS bad_iou_rows FROM public.iou_ledger WHERE amount <= 0;
-- SELECT COUNT(*) AS bad_settlement_rows FROM public.settlements WHERE amount <= 0;

-- Once both are confirmed 0 (either they come back empty, or you've cleaned
-- up what's there), lock the constraints in:
-- ALTER TABLE public.iou_ledger VALIDATE CONSTRAINT iou_ledger_amount_positive_chk;
-- ALTER TABLE public.settlements VALIDATE CONSTRAINT settlements_amount_positive_chk;
