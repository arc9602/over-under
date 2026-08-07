-- Multi-option bets: replace binary side_a/side_b with a bet_options table.

CREATE TABLE public.bet_options (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id     UUID NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  sort_order SMALLINT NOT NULL,
  UNIQUE (bet_id, sort_order)
);

ALTER TABLE public.bet_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can read bet_options"
  ON public.bet_options FOR SELECT
  USING (
    auth.uid() IN (SELECT creator_id FROM public.bets WHERE id = bet_id)
    OR auth.uid() IN (
      SELECT user_id FROM public.bet_participants WHERE bet_id = bet_options.bet_id
    )
  );

CREATE POLICY "Creators can insert bet_options"
  ON public.bet_options FOR INSERT
  WITH CHECK (
    auth.uid() IN (SELECT creator_id FROM public.bets WHERE id = bet_id)
  );

-- Backfill options from legacy side labels.
INSERT INTO public.bet_options (bet_id, label, sort_order)
SELECT id, side_a_label, 0 FROM public.bets;

INSERT INTO public.bet_options (bet_id, label, sort_order)
SELECT id, side_b_label, 1 FROM public.bets;

ALTER TABLE public.bet_participants ADD COLUMN option_id UUID REFERENCES public.bet_options(id);

UPDATE public.bet_participants bp
SET option_id = bo.id
FROM public.bet_options bo
WHERE bo.bet_id = bp.bet_id
  AND ((bp.side = 'a' AND bo.sort_order = 0) OR (bp.side = 'b' AND bo.sort_order = 1));

ALTER TABLE public.bet_participants ALTER COLUMN option_id SET NOT NULL;
ALTER TABLE public.bet_participants DROP COLUMN side;

ALTER TABLE public.resolutions ADD COLUMN proposed_winner_option_id UUID REFERENCES public.bet_options(id);

UPDATE public.resolutions r
SET proposed_winner_option_id = bo.id
FROM public.bet_options bo
WHERE bo.bet_id = r.bet_id
  AND ((r.proposed_winner_side = 'a' AND bo.sort_order = 0)
    OR (r.proposed_winner_side = 'b' AND bo.sort_order = 1));

ALTER TABLE public.resolutions ALTER COLUMN proposed_winner_option_id SET NOT NULL;
ALTER TABLE public.resolutions DROP COLUMN proposed_winner_side;

ALTER TABLE public.bets DROP COLUMN side_a_label;
ALTER TABLE public.bets DROP COLUMN side_b_label;

CREATE OR REPLACE FUNCTION public.place_wager(
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
  v_existing_option_id UUID;
  v_existing_amount NUMERIC;
  v_new_total NUMERIC;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bet_options WHERE id = p_option_id AND bet_id = p_bet_id
  ) THEN
    RAISE EXCEPTION 'Invalid option';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount';
  END IF;

  SELECT status, min_wager, max_wager INTO v_status, v_min, v_max
  FROM public.bets WHERE id = p_bet_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;
  IF v_status NOT IN ('open', 'active') THEN
    RAISE EXCEPTION 'This bet is no longer accepting wagers';
  END IF;

  SELECT option_id, amount INTO v_existing_option_id, v_existing_amount
  FROM public.bet_participants
  WHERE bet_id = p_bet_id AND user_id = p_user_id;

  IF FOUND AND v_existing_option_id <> p_option_id THEN
    RAISE EXCEPTION 'You already wagered on a different option';
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
    IF (
      SELECT COUNT(DISTINCT option_id)
      FROM public.bet_participants
      WHERE bet_id = p_bet_id
    ) >= 2 THEN
      UPDATE public.bets SET status = 'active' WHERE id = p_bet_id;
    END IF;
  END IF;
END;
$$;

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
  v_winner_option_id UUID;
  v_win_total NUMERIC;
  v_lose_total NUMERIC;
BEGIN
  SELECT r.bet_id, r.proposed_winner_option_id
  INTO v_bet_id, v_winner_option_id
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
  FROM public.bet_participants
  WHERE bet_id = v_bet_id AND option_id = v_winner_option_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_lose_total
  FROM public.bet_participants
  WHERE bet_id = v_bet_id AND option_id <> v_winner_option_id;

  IF v_win_total = 0 OR v_lose_total = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.iou_ledger (bet_id, creditor_id, debtor_id, amount)
  SELECT v_bet_id, w.user_id, l.user_id, ROUND(l.amount * (w.amount / v_win_total), 2)
  FROM public.bet_participants w
  JOIN public.bet_participants l
    ON l.bet_id = w.bet_id AND l.option_id <> w.option_id
  WHERE w.bet_id = v_bet_id AND w.option_id = v_winner_option_id;
END;
$$;
