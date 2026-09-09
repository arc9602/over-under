-- Bets can be staked in something other than money: a slice of pizza, a beer,
-- a push-up. Markets stay in dollars.
--
-- The unit has to travel with the debt, not just decorate the bet page. You
-- can owe someone $20 and 3 slices of pizza at once, and those are two
-- separate obligations -- adding them is meaningless, and so is cancelling a
-- "cycle" that runs through both. So iou_ledger and settlements carry the
-- unit, and everything that reasons about debt is partitioned by it.
--
-- Every function below is rewritten from its CURRENT definition, not from the
-- version it was first introduced in:
--   confirm_resolution        <- 011 (auth.uid + participant + self-confirm guards)
--   confirm_option_resolution <- 012 (same guards, option-based winner)
--   mirror_iou_to_ledger      <- 019
--   net_iou_positions         <- 019
--   simplify_debt_cycles      <- 019
-- Redefining any of them from an older body would silently drop the
-- authorization checks 010 and 011 added.

-- ============================================================
-- 1. Columns
-- ============================================================
-- IF NOT EXISTS throughout: these columns may already be present out of band.

-- 'USD' means money and is formatted as currency. Anything else is a
-- free-text singular label. The plural is stored rather than derived so an
-- awkward auto-plural is corrected once, at creation, instead of every screen
-- guessing.
ALTER TABLE public.bets ADD COLUMN IF NOT EXISTS stake_unit TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE public.bets ADD COLUMN IF NOT EXISTS stake_unit_plural TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bets_stake_unit_chk') THEN
    ALTER TABLE public.bets ADD CONSTRAINT bets_stake_unit_chk
      CHECK (length(trim(stake_unit)) BETWEEN 1 AND 40);
  END IF;
END $$;

-- Denormalized onto the ledger rather than joined back to bets: an iou_ledger
-- row may come from a bet OR a market (008), so grouping balances by unit
-- would otherwise mean joining two different parent tables per row.
ALTER TABLE public.iou_ledger ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE public.iou_ledger ADD COLUMN IF NOT EXISTS unit_plural TEXT;

ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS unit_plural TEXT;

-- Every pre-existing row was money, so the 'USD' default is already correct
-- and no backfill is needed.

CREATE INDEX IF NOT EXISTS iou_ledger_unit_idx ON public.iou_ledger (unit);
-- simplify_debt_cycles walks outstanding rows for one pair in one unit.
CREATE INDEX IF NOT EXISTS iou_ledger_pair_unit_idx
  ON public.iou_ledger (debtor_id, creditor_id, unit) WHERE settled = FALSE;

COMMENT ON COLUMN public.iou_ledger.unit IS
  'What this debt is denominated in. ''USD'' is money; anything else is a '
  'free-text label from bets.stake_unit. Debts in different units never net '
  'against each other and never share a simplification cycle.';

-- ============================================================
-- 2. Payout: both resolution paths carry the bet's unit
-- ============================================================
-- Since 012 there are two of these -- the legacy two-sided path and the
-- multi-option one. A bet has exactly one unit, so both must stamp it.

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
  v_unit TEXT;
  v_unit_plural TEXT;
BEGIN
  IF p_confirmer_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;

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

  SELECT b.stake_unit, b.stake_unit_plural INTO v_unit, v_unit_plural
  FROM public.bets b WHERE b.id = v_bet_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_win_total
  FROM public.bet_participants WHERE bet_id = v_bet_id AND side = v_winner_side;
  SELECT COALESCE(SUM(amount), 0) INTO v_lose_total
  FROM public.bet_participants WHERE bet_id = v_bet_id AND side <> v_winner_side;

  IF v_win_total = 0 OR v_lose_total = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.iou_ledger (bet_id, creditor_id, debtor_id, amount, unit, unit_plural)
  SELECT v_bet_id, w.user_id, l.user_id, ROUND(l.amount * (w.amount / v_win_total), 2),
         COALESCE(v_unit, 'USD'), v_unit_plural
  FROM public.bet_participants w
  JOIN public.bet_participants l ON l.bet_id = w.bet_id AND l.side <> w.side
  WHERE w.bet_id = v_bet_id AND w.side = v_winner_side;
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
  v_unit TEXT;
  v_unit_plural TEXT;
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

  SELECT b.stake_unit, b.stake_unit_plural INTO v_unit, v_unit_plural
  FROM public.bets b WHERE b.id = v_bet_id;

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
  INSERT INTO public.iou_ledger (bet_id, creditor_id, debtor_id, amount, unit, unit_plural)
  SELECT v_bet_id, w.user_id, l.user_id, pair.amount,
         COALESCE(v_unit, 'USD'), v_unit_plural
  FROM public.bet_participants w
  JOIN public.bet_participants l ON l.bet_id = w.bet_id AND l.option_id <> w.option_id
  CROSS JOIN LATERAL (
    SELECT ROUND(l.amount * (w.amount / v_win_total), 2) AS amount
  ) pair
  WHERE w.bet_id = v_bet_id AND w.option_id = v_winner_option_id
    AND pair.amount > 0;
END;
$$;

-- ============================================================
-- 3. The double-entry ledger stays money-only
-- ============================================================
-- ledger_postings (012) is a money ledger: record_ledger_transaction sums
-- amounts into balances with no notion of what they are denominated in.
-- Mirroring a 3-slice IOU into it would post 3.00 alongside dollars and
-- quietly corrupt every balance it feeds.
--
-- Non-money debt therefore lives in iou_ledger alone -- it is a social
-- tracker, not accounting, and nothing downstream of the double-entry ledger
-- (escrow, USDC custody, payouts) can act on a slice of pizza anyway. The
-- skip mirrors the simplification_id skip already here.
CREATE OR REPLACE FUNCTION public.mirror_iou_to_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.simplification_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.unit IS DISTINCT FROM 'USD' THEN
    RETURN NEW;
  END IF;

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

-- ============================================================
-- 4. Net positions, per user AND per unit
-- ============================================================
-- Keyed 'user_id|unit' rather than 'user_id'. Summing a user's dollars and
-- slices into one number would make the drift check in simplify_debt_cycles
-- blind to the one mistake it exists to catch: cancelling an edge in one unit
-- against an edge in another nets to zero overall and would slip straight
-- through. Splitting the key makes that a detectable drift instead.
--
-- Only simplify_debt_cycles calls this, so the key change is contained.
CREATE OR REPLACE FUNCTION public.net_iou_positions(p_users UUID[])
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER STABLE SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_object_agg(user_id::TEXT || '|' || unit, net), '{}'::JSONB)
  FROM (
    SELECT user_id, unit, SUM(delta) AS net
    FROM (
      SELECT creditor_id AS user_id, unit,  amount AS delta
        FROM public.iou_ledger
        WHERE settled = FALSE AND creditor_id = ANY(p_users)
      UNION ALL
      SELECT debtor_id   AS user_id, unit, -amount AS delta
        FROM public.iou_ledger
        WHERE settled = FALSE AND debtor_id = ANY(p_users)
    ) entries
    GROUP BY user_id, unit
  ) totals;
$$;

REVOKE ALL ON FUNCTION public.net_iou_positions(UUID[]) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 5. Simplification runs inside a unit, never across units
-- ============================================================
-- Each reduction now names the unit it applies to. "A owes B $10, B owes C 3
-- slices, C owes A $10" is not a cycle and must never cancel; keeping the
-- unit on every reduction, on the row filter, and on the carried-forward
-- remainder is what prevents it. The caller partitions the graph by unit and
-- runs the cycle search once per partition (lib/utils/simplifyDebts.ts is
-- unchanged -- it operates on one partition at a time).
CREATE OR REPLACE FUNCTION public.simplify_debt_cycles(
  p_user_id UUID,
  p_reductions JSONB
)
RETURNS public.debt_simplifications
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_before JSONB;
  v_after JSONB;
  v_drift TEXT;
  v_users UUID[];
  v_simplification public.debt_simplifications;
  v_reduction JSONB;
  v_debtor UUID;
  v_creditor UUID;
  v_unit TEXT;
  v_remaining NUMERIC;
  v_row RECORD;
  v_take NUMERIC;
  v_pairs INT := 0;
  v_cents BIGINT := 0;
  v_settled INT := 0;
  v_split INT := 0;
BEGIN
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;

  IF p_reductions IS NULL OR jsonb_typeof(p_reductions) <> 'array' THEN
    RAISE EXCEPTION 'Reductions must be a JSON array';
  END IF;

  IF jsonb_array_length(p_reductions) = 0 THEN
    RAISE EXCEPTION 'Nothing to simplify';
  END IF;

  IF NOT public.check_rate_limit(p_user_id, 'simplify_debts', 5, 60) THEN
    RAISE EXCEPTION 'Too many simplification attempts -- wait a moment and try again';
  END IF;

  SELECT ARRAY(
    SELECT (r ->> 'debtor')::UUID FROM jsonb_array_elements(p_reductions) r
    UNION
    SELECT (r ->> 'creditor')::UUID FROM jsonb_array_elements(p_reductions) r
  ) INTO v_users;

  -- Lock every unsettled row for these users, in every unit. Locking only the
  -- units named in the plan would leave the other units' rows free to move,
  -- and the per-unit drift check below reads all of them.
  PERFORM 1 FROM public.iou_ledger
  WHERE settled = FALSE
    AND (debtor_id = ANY(v_users) OR creditor_id = ANY(v_users))
  ORDER BY id
  FOR UPDATE;

  v_before := public.net_iou_positions(v_users);

  INSERT INTO public.debt_simplifications (initiated_by)
  VALUES (p_user_id)
  RETURNING * INTO v_simplification;

  FOR v_reduction IN SELECT * FROM jsonb_array_elements(p_reductions)
  LOOP
    v_debtor   := (v_reduction ->> 'debtor')::UUID;
    v_creditor := (v_reduction ->> 'creditor')::UUID;
    -- Absent unit means money, so a caller that predates units still works.
    v_unit     := COALESCE(v_reduction ->> 'unit', 'USD');
    v_remaining := (v_reduction ->> 'cents')::BIGINT::NUMERIC / 100;

    IF v_debtor IS NULL OR v_creditor IS NULL THEN
      RAISE EXCEPTION 'Every reduction needs a debtor and a creditor';
    END IF;
    IF v_debtor = v_creditor THEN
      RAISE EXCEPTION 'A reduction cannot name the same user twice';
    END IF;
    IF v_remaining IS NULL OR v_remaining <= 0 THEN
      RAISE EXCEPTION 'Reduction amounts must be positive';
    END IF;

    v_pairs := v_pairs + 1;

    FOR v_row IN
      SELECT id, amount, bet_id, market_id, unit, unit_plural
      FROM public.iou_ledger
      WHERE debtor_id = v_debtor AND creditor_id = v_creditor
        AND unit = v_unit
        AND settled = FALSE
      ORDER BY created_at ASC, id ASC
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_take := LEAST(v_row.amount, v_remaining);

      IF v_take >= v_row.amount THEN
        UPDATE public.iou_ledger
        SET settled = TRUE, settled_at = NOW(), simplification_id = v_simplification.id
        WHERE id = v_row.id;
        v_settled := v_settled + 1;
      ELSE
        UPDATE public.iou_ledger
        SET settled = TRUE, settled_at = NOW(), simplification_id = v_simplification.id
        WHERE id = v_row.id;

        -- The remainder inherits the parent's unit as well as its source: a
        -- carried-forward slice of pizza must not come back as dollars.
        INSERT INTO public.iou_ledger
          (bet_id, market_id, creditor_id, debtor_id, amount, unit, unit_plural, simplification_id)
        VALUES
          (v_row.bet_id, v_row.market_id, v_creditor, v_debtor,
           v_row.amount - v_take, v_row.unit, v_row.unit_plural, v_simplification.id);

        v_split := v_split + 1;
      END IF;

      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION
        'Debt from % to % in % changed while simplifying -- please try again',
        v_debtor, v_creditor, v_unit;
    END IF;

    -- Counts minor units across every unit in the plan, so a mixed run adds
    -- cents to hundredths-of-a-slice. It is an audit counter, not money.
    v_cents := v_cents + (v_reduction ->> 'cents')::BIGINT;
  END LOOP;

  -- ------------------------------------------------------------------
  -- The check everything rests on.
  -- ------------------------------------------------------------------
  -- Cancelling loops must leave every user's net position bit-for-bit
  -- identical IN EVERY UNIT. Keys are 'user|unit', so cancelling a dollar
  -- edge against a pizza edge shows up as two drifted keys rather than
  -- netting invisibly to zero.
  v_after := public.net_iou_positions(v_users);

  WITH before_positions AS (
    SELECT key AS user_unit, value::NUMERIC AS net FROM jsonb_each_text(v_before)
  ),
  after_positions AS (
    SELECT key AS user_unit, value::NUMERIC AS net FROM jsonb_each_text(v_after)
  )
  SELECT string_agg(COALESCE(b.user_unit, a.user_unit), ', ')
  INTO v_drift
  FROM before_positions b
  FULL OUTER JOIN after_positions a ON b.user_unit = a.user_unit
  WHERE COALESCE(b.net, 0) IS DISTINCT FROM COALESCE(a.net, 0);

  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to simplify: net position changed for %. No debt was altered.', v_drift;
  END IF;

  UPDATE public.debt_simplifications
  SET pairs_reduced = v_pairs,
      cents_cancelled  = v_cents,
      rows_settled     = v_settled,
      rows_split       = v_split
  WHERE id = v_simplification.id
  RETURNING * INTO v_simplification;

  RETURN v_simplification;
END;
$$;

-- ============================================================
-- 6. Multi-option bet creation carries the unit too
-- ============================================================
-- confirm_option_resolution already reads stake_unit off the bet, so
-- multi-option payouts were going to be unit-correct the moment the column
-- existed. This is the other half: letting the creator actually set one.
--
-- DROP before CREATE because the parameter list changes. CREATE OR REPLACE
-- with two extra defaulted arguments does not replace the 7-argument
-- function -- it defines a second, overloaded one, and every existing
-- 7-argument call then fails as ambiguous rather than resolving to either.
DROP FUNCTION IF EXISTS public.create_bet_with_options(
  UUID, TEXT, TEXT, TEXT[], NUMERIC, NUMERIC, TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.create_bet_with_options(
  p_creator_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_option_labels TEXT[],
  p_min_wager NUMERIC,
  p_max_wager NUMERIC,
  p_deadline TIMESTAMPTZ,
  p_stake_unit TEXT DEFAULT 'USD',
  p_stake_unit_plural TEXT DEFAULT NULL
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
  IF p_stake_unit IS NULL OR length(trim(p_stake_unit)) = 0 THEN
    RAISE EXCEPTION 'A bet needs something to be staked in';
  END IF;

  INSERT INTO public.bets (
    title, description, side_a_label, side_b_label, min_wager, max_wager, deadline, creator_id,
    stake_unit, stake_unit_plural
  ) VALUES (
    p_title, p_description, p_option_labels[1], p_option_labels[2],
    p_min_wager, p_max_wager, p_deadline, p_creator_id,
    p_stake_unit, p_stake_unit_plural
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
