-- Trigger: create profile row on new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Atomic bet creation: creates bet + adds creator as side A
CREATE OR REPLACE FUNCTION public.create_bet_with_participant(
  p_title TEXT,
  p_description TEXT,
  p_side_a_label TEXT,
  p_side_b_label TEXT,
  p_stake NUMERIC,
  p_deadline TIMESTAMPTZ,
  p_creator_id UUID
)
RETURNS TABLE(bet_id UUID, invite_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bet_id UUID;
  v_invite_code TEXT;
BEGIN
  INSERT INTO public.bets (title, description, side_a_label, side_b_label, stake, deadline, creator_id)
  VALUES (p_title, p_description, p_side_a_label, p_side_b_label, p_stake, p_deadline, p_creator_id)
  RETURNING id, bets.invite_code INTO v_bet_id, v_invite_code;

  INSERT INTO public.bet_participants (bet_id, user_id, side)
  VALUES (v_bet_id, p_creator_id, 'a');

  RETURN QUERY SELECT v_bet_id, v_invite_code;
END;
$$;

-- Atomic resolution confirmation: updates resolution + bet + inserts IOU
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
  v_creditor_id UUID;
  v_debtor_id UUID;
  v_stake NUMERIC;
  v_dispute_count INT;
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

  SELECT bp_w.user_id, bp_l.user_id, b.stake
  INTO v_creditor_id, v_debtor_id, v_stake
  FROM public.bets b
  JOIN public.bet_participants bp_w ON bp_w.bet_id = b.id AND bp_w.side = v_winner_side
  JOIN public.bet_participants bp_l ON bp_l.bet_id = b.id AND bp_l.side != v_winner_side
  WHERE b.id = v_bet_id;

  INSERT INTO public.iou_ledger (bet_id, creditor_id, debtor_id, amount)
  VALUES (v_bet_id, v_creditor_id, v_debtor_id, v_stake);
END;
$$;

-- Dispute resolution: marks resolution disputed, resets bet to active or stuck
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
    UPDATE public.bets SET status = 'active' WHERE id = v_bet_id;
  END IF;
END;
$$;
