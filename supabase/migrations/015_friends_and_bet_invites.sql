BEGIN;

CREATE TABLE public.friend_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CHECK (requester_id <> recipient_id)
);

CREATE UNIQUE INDEX friend_requests_one_pending_pair_idx
  ON public.friend_requests (
    LEAST(requester_id, recipient_id),
    GREATEST(requester_id, recipient_id)
  )
  WHERE status = 'pending';

CREATE INDEX friend_requests_recipient_idx
  ON public.friend_requests(recipient_id, status, created_at DESC);
CREATE INDEX friend_requests_requester_idx
  ON public.friend_requests(requester_id, status, created_at DESC);

CREATE TABLE public.friendships (
  user_low_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_high_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_id   UUID UNIQUE REFERENCES public.friend_requests(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id)
);

CREATE INDEX friendships_high_user_idx
  ON public.friendships(user_high_id, created_at DESC);

CREATE TABLE public.bet_invites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id     UUID NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  inviter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'seen', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at  TIMESTAMPTZ,
  UNIQUE (bet_id, invitee_id),
  CHECK (inviter_id <> invitee_id)
);

CREATE INDEX bet_invites_invitee_idx
  ON public.bet_invites(invitee_id, status, created_at DESC);
CREATE INDEX bet_invites_inviter_idx
  ON public.bet_invites(inviter_id, created_at DESC);

ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their friend requests"
  ON public.friend_requests FOR SELECT
  USING (auth.uid() = requester_id OR auth.uid() = recipient_id);

CREATE POLICY "Users can read their friendships"
  ON public.friendships FOR SELECT
  USING (auth.uid() = user_low_id OR auth.uid() = user_high_id);

CREATE POLICY "Users can read their bet invites"
  ON public.bet_invites FOR SELECT
  USING (auth.uid() = inviter_id OR auth.uid() = invitee_id);

REVOKE INSERT, UPDATE, DELETE ON public.friend_requests
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.friendships
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.bet_invites
  FROM anon, authenticated;

GRANT SELECT ON public.friend_requests TO authenticated;
GRANT SELECT ON public.friendships TO authenticated;
GRANT SELECT ON public.bet_invites TO authenticated;

-- This helper accepts caller-supplied limits and is only safe when reached
-- from trusted SECURITY DEFINER mutation functions.
REVOKE ALL ON FUNCTION public.check_rate_limit(UUID, TEXT, INT, INT)
  FROM PUBLIC, anon, authenticated;

-- Status expiry is synthesized on reads, so enforce the actual deadline at
-- the table boundary as well. This covers both binary and multi-option RPCs,
-- including top-ups that UPDATE an existing participant row.
CREATE FUNCTION public.enforce_bet_wager_deadline()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.bets
    WHERE id = NEW.bet_id
      AND deadline IS NOT NULL
      AND deadline <= NOW()
  ) THEN
    RAISE EXCEPTION 'This bet has expired and no longer accepts wagers';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_bet_wager_deadline
  BEFORE INSERT OR UPDATE OF amount, side, option_id
  ON public.bet_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_bet_wager_deadline();

REVOKE ALL ON FUNCTION public.enforce_bet_wager_deadline()
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.send_friend_request(p_recipient_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_request_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_user_id THEN
    RAISE EXCEPTION 'You cannot send a friend request to yourself';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_recipient_id
  ) THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF NOT public.check_rate_limit(v_user_id, 'send_friend_request', 20, 60) THEN
    RAISE EXCEPTION 'Too many friend requests -- wait a moment and try again';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.friendships
    WHERE user_low_id = LEAST(v_user_id, p_recipient_id)
      AND user_high_id = GREATEST(v_user_id, p_recipient_id)
  ) THEN
    RAISE EXCEPTION 'You are already friends';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.friend_requests
    WHERE requester_id = p_recipient_id
      AND recipient_id = v_user_id
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'This user already sent you a friend request';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.friend_requests
    WHERE requester_id = v_user_id
      AND recipient_id = p_recipient_id
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Friend request already sent';
  END IF;

  INSERT INTO public.friend_requests (requester_id, recipient_id)
  VALUES (v_user_id, p_recipient_id)
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

CREATE FUNCTION public.respond_friend_request(
  p_request_id UUID,
  p_accept BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_requester_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_request_id IS NULL OR p_accept IS NULL THEN
    RAISE EXCEPTION 'Invalid friend request response';
  END IF;

  SELECT requester_id
  INTO v_requester_id
  FROM public.friend_requests
  WHERE id = p_request_id
    AND recipient_id = v_user_id
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Friend request not found or already handled';
  END IF;

  UPDATE public.friend_requests
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
      responded_at = NOW()
  WHERE id = p_request_id;

  IF p_accept THEN
    INSERT INTO public.friendships (
      user_low_id,
      user_high_id,
      request_id
    )
    VALUES (
      LEAST(v_user_id, v_requester_id),
      GREATEST(v_user_id, v_requester_id),
      p_request_id
    )
    ON CONFLICT (user_low_id, user_high_id) DO NOTHING;
  END IF;
END;
$$;

CREATE FUNCTION public.cancel_friend_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.friend_requests
  SET status = 'cancelled',
      responded_at = NOW()
  WHERE id = p_request_id
    AND requester_id = v_user_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Friend request not found or already handled';
  END IF;
END;
$$;

CREATE FUNCTION public.remove_friend(p_friend_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_friend_id IS NULL OR p_friend_id = v_user_id THEN
    RAISE EXCEPTION 'Invalid friend';
  END IF;

  DELETE FROM public.friendships
  WHERE user_low_id = LEAST(v_user_id, p_friend_id)
    AND user_high_id = GREATEST(v_user_id, p_friend_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Friendship not found';
  END IF;
END;
$$;

CREATE FUNCTION public.invite_friend_to_bet(
  p_bet_id UUID,
  p_invitee_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_invite_id UUID;
  v_bet_status TEXT;
  v_bet_deadline TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_invitee_id IS NULL OR p_invitee_id = v_user_id THEN
    RAISE EXCEPTION 'You cannot invite yourself';
  END IF;
  IF NOT public.check_rate_limit(v_user_id, 'invite_friend_to_bet', 30, 60) THEN
    RAISE EXCEPTION 'Too many bet invites -- wait a moment and try again';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.friendships
    WHERE user_low_id = LEAST(v_user_id, p_invitee_id)
      AND user_high_id = GREATEST(v_user_id, p_invitee_id)
  ) THEN
    RAISE EXCEPTION 'You can only invite accepted friends';
  END IF;

  SELECT status, deadline
  INTO v_bet_status, v_bet_deadline
  FROM public.bets
  WHERE id = p_bet_id
    AND (
      creator_id = v_user_id
      OR public.is_bet_participant(id, v_user_id)
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bet not found or access denied';
  END IF;
  IF v_bet_status NOT IN ('open', 'active') THEN
    RAISE EXCEPTION 'This bet is no longer accepting invitations';
  END IF;
  IF v_bet_deadline IS NOT NULL AND v_bet_deadline <= NOW() THEN
    RAISE EXCEPTION 'This bet has expired and no longer accepts invitations';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.bet_participants
    WHERE bet_id = p_bet_id
      AND user_id = p_invitee_id
  ) THEN
    RAISE EXCEPTION 'This friend already joined the bet';
  END IF;

  INSERT INTO public.bet_invites (
    bet_id,
    inviter_id,
    invitee_id
  )
  VALUES (
    p_bet_id,
    v_user_id,
    p_invitee_id
  )
  ON CONFLICT (bet_id, invitee_id)
  DO UPDATE
  SET inviter_id = EXCLUDED.inviter_id,
      status = 'pending',
      created_at = NOW(),
      opened_at = NULL
  WHERE public.bet_invites.status = 'declined'
  RETURNING id INTO v_invite_id;

  IF v_invite_id IS NULL THEN
    RAISE EXCEPTION 'This friend has already been invited';
  END IF;

  RETURN v_invite_id;
END;
$$;

CREATE FUNCTION public.update_bet_invite(
  p_invite_id UUID,
  p_action TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_action NOT IN ('seen', 'declined') THEN
    RAISE EXCEPTION 'Invalid invite action';
  END IF;

  UPDATE public.bet_invites
  SET status = p_action,
      opened_at = CASE
        WHEN p_action = 'seen' THEN COALESCE(opened_at, NOW())
        ELSE opened_at
      END
  WHERE id = p_invite_id
    AND invitee_id = v_user_id
    AND status IN ('pending', 'seen');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bet invite not found or already handled';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.send_friend_request(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_friend_request(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.respond_friend_request(UUID, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(UUID, BOOLEAN)
  TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_friend_request(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_friend_request(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.remove_friend(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_friend(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.invite_friend_to_bet(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_friend_to_bet(UUID, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.update_bet_invite(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_bet_invite(UUID, TEXT)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
