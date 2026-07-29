-- min_wager/max_wager now apply to a user's CUMULATIVE wager on a bet, not
-- each individual top-up. E.g. max_wager=$100: if you've already wagered
-- $80, you can add up to $20 more, not another $100.

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
