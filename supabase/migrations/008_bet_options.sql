BEGIN;

-- Expand the binary model without removing legacy columns. This keeps the
-- currently deployed two-option app working while multi-option code rolls out.
CREATE TABLE public.bet_options (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id     UUID NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  label      TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 50),
  sort_order SMALLINT NOT NULL CHECK (sort_order BETWEEN 0 AND 9),
  UNIQUE (id, bet_id),
  UNIQUE (bet_id, sort_order)
);

CREATE UNIQUE INDEX bet_options_label_unique_idx
  ON public.bet_options (bet_id, lower(btrim(label)));
CREATE INDEX bet_options_bet_idx ON public.bet_options (bet_id);

ALTER TABLE public.bet_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bet members can read options"
  ON public.bet_options FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.bets
      WHERE bets.id = bet_options.bet_id
        AND (
          bets.creator_id = auth.uid()
          OR public.is_bet_participant(bets.id, auth.uid())
        )
    )
  );

-- Existing bets retain their labels and gain stable option rows.
-- Legacy labels had no length/non-empty/uniqueness constraints, so normalize
-- them during backfill instead of allowing historical data to abort rollout.
WITH normalized AS (
  SELECT
    id,
    COALESCE(NULLIF(left(btrim(side_a_label), 50), ''), 'Option 1') AS label_a,
    COALESCE(NULLIF(left(btrim(side_b_label), 50), ''), 'Option 2') AS label_b
  FROM public.bets
),
options AS (
  SELECT id AS bet_id, label_a AS label, 0 AS sort_order
  FROM normalized
  UNION ALL
  SELECT
    id,
    CASE
      WHEN lower(label_b) <> lower(label_a) THEN label_b
      WHEN lower(label_a) <> 'option 2' THEN 'Option 2'
      ELSE 'Option 2 (legacy)'
    END,
    1
  FROM normalized
)
INSERT INTO public.bet_options (bet_id, label, sort_order)
SELECT bet_id, label, sort_order FROM options;

-- Bets created by the legacy app after this migration must also be ready when
-- the feature flag is enabled later.
CREATE FUNCTION public.create_legacy_bet_options()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_label_a TEXT;
  v_label_b TEXT;
BEGIN
  v_label_a :=
    COALESCE(NULLIF(left(btrim(NEW.side_a_label), 50), ''), 'Option 1');
  v_label_b :=
    COALESCE(NULLIF(left(btrim(NEW.side_b_label), 50), ''), 'Option 2');

  IF lower(v_label_b) = lower(v_label_a) THEN
    v_label_b :=
      CASE
        WHEN lower(v_label_a) <> 'option 2' THEN 'Option 2'
        ELSE 'Option 2 (legacy)'
      END;
  END IF;

  INSERT INTO public.bet_options (bet_id, label, sort_order)
  VALUES
    (NEW.id, v_label_a, 0),
    (NEW.id, v_label_b, 1);

  RETURN NEW;
END;
$$;

CREATE TRIGGER create_legacy_bet_options
  AFTER INSERT ON public.bets
  FOR EACH ROW
  EXECUTE FUNCTION public.create_legacy_bet_options();

REVOKE ALL ON FUNCTION public.create_legacy_bet_options() FROM PUBLIC;

ALTER TABLE public.bet_participants
  ADD COLUMN option_id UUID;

UPDATE public.bet_participants bp
SET option_id = bo.id
FROM public.bet_options bo
WHERE bo.bet_id = bp.bet_id
  AND bo.sort_order = CASE bp.side WHEN 'a' THEN 0 WHEN 'b' THEN 1 END;

ALTER TABLE public.bet_participants
  ADD CONSTRAINT bet_participants_option_bet_fkey
  FOREIGN KEY (option_id, bet_id)
  REFERENCES public.bet_options(id, bet_id);

CREATE INDEX bet_participants_option_idx
  ON public.bet_participants(option_id);

-- New options beyond the first two have no legacy binary-side representation.
ALTER TABLE public.bet_participants
  ALTER COLUMN side DROP NOT NULL;

ALTER TABLE public.resolutions
  ADD COLUMN proposed_winner_option_id UUID;

UPDATE public.resolutions r
SET proposed_winner_option_id = bo.id
FROM public.bet_options bo
WHERE bo.bet_id = r.bet_id
  AND bo.sort_order =
    CASE r.proposed_winner_side WHEN 'a' THEN 0 WHEN 'b' THEN 1 END;

ALTER TABLE public.resolutions
  ADD CONSTRAINT resolutions_winner_option_bet_fkey
  FOREIGN KEY (proposed_winner_option_id, bet_id)
  REFERENCES public.bet_options(id, bet_id);

ALTER TABLE public.resolutions
  ALTER COLUMN proposed_winner_side DROP NOT NULL;

-- Keep legacy writes synchronized while the feature flag is disabled.
CREATE FUNCTION public.map_legacy_participant_option()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_option_sort SMALLINT;
BEGIN
  IF NEW.option_id IS NULL THEN
    IF NEW.side IS NULL THEN
      RAISE EXCEPTION 'A wager must have an option';
    END IF;

    SELECT id INTO NEW.option_id
    FROM public.bet_options
    WHERE bet_id = NEW.bet_id
      AND sort_order = CASE NEW.side WHEN 'a' THEN 0 WHEN 'b' THEN 1 END;

    IF NEW.option_id IS NULL THEN
      RAISE EXCEPTION 'Invalid legacy wager side';
    END IF;
  ELSE
    SELECT sort_order INTO v_option_sort
    FROM public.bet_options
    WHERE id = NEW.option_id AND bet_id = NEW.bet_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid wager option';
    END IF;
    IF NEW.side IS NOT NULL
      AND NEW.side IS DISTINCT FROM
        CASE v_option_sort WHEN 0 THEN 'a' WHEN 1 THEN 'b' ELSE NULL END THEN
      RAISE EXCEPTION 'Wager side and option do not match';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER map_legacy_participant_option
  BEFORE INSERT OR UPDATE OF bet_id, side, option_id
  ON public.bet_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.map_legacy_participant_option();

CREATE FUNCTION public.map_legacy_resolution_option()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_option_sort SMALLINT;
BEGIN
  IF NEW.proposed_winner_option_id IS NULL THEN
    IF NEW.proposed_winner_side IS NULL THEN
      RAISE EXCEPTION 'A resolution must have a winning option';
    END IF;

    SELECT id INTO NEW.proposed_winner_option_id
    FROM public.bet_options
    WHERE bet_id = NEW.bet_id
      AND sort_order =
        CASE NEW.proposed_winner_side WHEN 'a' THEN 0 WHEN 'b' THEN 1 END;

    IF NEW.proposed_winner_option_id IS NULL THEN
      RAISE EXCEPTION 'Invalid legacy winning side';
    END IF;
  ELSE
    SELECT sort_order INTO v_option_sort
    FROM public.bet_options
    WHERE id = NEW.proposed_winner_option_id AND bet_id = NEW.bet_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid winning option';
    END IF;
    IF NEW.proposed_winner_side IS NOT NULL
      AND NEW.proposed_winner_side IS DISTINCT FROM
        CASE v_option_sort WHEN 0 THEN 'a' WHEN 1 THEN 'b' ELSE NULL END THEN
      RAISE EXCEPTION 'Winning side and option do not match';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER map_legacy_resolution_option
  BEFORE INSERT OR UPDATE OF
    bet_id, proposed_winner_side, proposed_winner_option_id
  ON public.resolutions
  FOR EACH ROW
  EXECUTE FUNCTION public.map_legacy_resolution_option();

REVOKE ALL ON FUNCTION public.map_legacy_participant_option() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.map_legacy_resolution_option() FROM PUBLIC;

-- Resolution state transitions and payouts must only happen through RPCs.
DROP POLICY IF EXISTS "Participants can update resolutions"
  ON public.resolutions;

-- Repair any historical race before enforcing one active proposal per bet.
WITH duplicate_pending AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY bet_id
      ORDER BY created_at DESC, id DESC
    ) AS proposal_number
  FROM public.resolutions
  WHERE status = 'pending'
)
UPDATE public.resolutions r
SET status = 'superseded',
    resolved_at = COALESCE(r.resolved_at, NOW())
FROM duplicate_pending duplicate
WHERE r.id = duplicate.id
  AND duplicate.proposal_number > 1;

CREATE UNIQUE INDEX resolutions_one_pending_per_bet_idx
  ON public.resolutions (bet_id)
  WHERE status = 'pending';

-- Direct resolution inserts remain temporarily for the legacy app, but now
-- require a locked bet and a winner option belonging to that same bet.
DROP POLICY IF EXISTS "Participants can insert resolutions" ON public.resolutions;
CREATE POLICY "Participants can insert resolutions"
  ON public.resolutions FOR INSERT
  WITH CHECK (
    auth.uid() = proposed_by
    AND public.is_bet_participant(resolutions.bet_id, auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.bets
      WHERE bets.id = resolutions.bet_id
        AND bets.status = 'locked'
    )
    AND (
      proposed_winner_option_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.bet_options
        WHERE bet_options.id = proposed_winner_option_id
          AND bet_options.bet_id = resolutions.bet_id
      )
    )
  );

-- Multi-option wager primitive. Caller identity always comes from the JWT.
CREATE FUNCTION public.place_option_wager(
  p_bet_id UUID,
  p_option_id UUID,
  p_amount NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_status TEXT;
  v_min NUMERIC;
  v_max NUMERIC;
  v_option_sort SMALLINT;
  v_existing_option_id UUID;
  v_existing_amount NUMERIC;
  v_new_total NUMERIC;
  v_legacy_side TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount';
  END IF;

  SELECT sort_order INTO v_option_sort
  FROM public.bet_options
  WHERE id = p_option_id AND bet_id = p_bet_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid option';
  END IF;

  SELECT status, min_wager, max_wager
  INTO v_status, v_min, v_max
  FROM public.bets
  WHERE id = p_bet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;
  IF v_status NOT IN ('open', 'active') THEN
    RAISE EXCEPTION 'This bet is no longer accepting wagers';
  END IF;

  SELECT option_id, amount
  INTO v_existing_option_id, v_existing_amount
  FROM public.bet_participants
  WHERE bet_id = p_bet_id AND user_id = v_user_id;

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
    WHERE bet_id = p_bet_id AND user_id = v_user_id;
  ELSE
    v_legacy_side :=
      CASE v_option_sort WHEN 0 THEN 'a' WHEN 1 THEN 'b' ELSE NULL END;

    INSERT INTO public.bet_participants
      (bet_id, user_id, option_id, side, amount)
    VALUES
      (p_bet_id, v_user_id, p_option_id, v_legacy_side, p_amount);
  END IF;

  IF v_status = 'open' AND (
    SELECT COUNT(DISTINCT option_id)
    FROM public.bet_participants
    WHERE bet_id = p_bet_id
  ) >= 2 THEN
    UPDATE public.bets SET status = 'active' WHERE id = p_bet_id;
  END IF;
END;
$$;

-- Bet + options + optional creator wager are committed atomically.
CREATE FUNCTION public.create_bet_with_options(
  p_title TEXT,
  p_description TEXT,
  p_option_labels TEXT[],
  p_min_wager NUMERIC,
  p_max_wager NUMERIC,
  p_deadline TIMESTAMPTZ,
  p_creator_option_index INTEGER DEFAULT NULL,
  p_creator_amount NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_bet_id UUID;
  v_option_id UUID;
  v_option_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_option_count := COALESCE(array_length(p_option_labels, 1), 0);
  IF v_option_count < 2 OR v_option_count > 10 THEN
    RAISE EXCEPTION 'A bet must have between 2 and 10 options';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'Invalid title';
  END IF;
  IF p_description IS NOT NULL AND length(p_description) > 500 THEN
    RAISE EXCEPTION 'Description is too long';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_option_labels) AS label
    WHERE length(btrim(label)) NOT BETWEEN 1 AND 50
  ) THEN
    RAISE EXCEPTION 'Option labels must be between 1 and 50 characters';
  END IF;
  IF (
    SELECT COUNT(DISTINCT lower(btrim(label)))
    FROM unnest(p_option_labels) AS label
  ) <> v_option_count THEN
    RAISE EXCEPTION 'Option labels must be unique';
  END IF;
  IF p_min_wager IS NOT NULL AND p_min_wager <= 0
    OR p_max_wager IS NOT NULL AND p_max_wager <= 0
    OR p_min_wager IS NOT NULL AND p_max_wager IS NOT NULL
      AND p_min_wager > p_max_wager THEN
    RAISE EXCEPTION 'Invalid wager limits';
  END IF;
  IF (p_creator_option_index IS NULL) <> (p_creator_amount IS NULL) THEN
    RAISE EXCEPTION 'Creator option and amount must be provided together';
  END IF;
  IF p_creator_option_index IS NOT NULL
    AND (p_creator_option_index < 0 OR p_creator_option_index >= v_option_count) THEN
    RAISE EXCEPTION 'Invalid creator option';
  END IF;

  INSERT INTO public.bets (
    title,
    description,
    side_a_label,
    side_b_label,
    min_wager,
    max_wager,
    deadline,
    creator_id
  )
  VALUES (
    btrim(p_title),
    NULLIF(btrim(p_description), ''),
    btrim(p_option_labels[1]),
    btrim(p_option_labels[2]),
    p_min_wager,
    p_max_wager,
    p_deadline,
    v_user_id
  )
  RETURNING id INTO v_bet_id;

  INSERT INTO public.bet_options (bet_id, label, sort_order)
  SELECT v_bet_id, btrim(p_option_labels[i]), i - 1
  FROM generate_subscripts(p_option_labels, 1) AS i
  ON CONFLICT (bet_id, sort_order)
  DO UPDATE SET label = EXCLUDED.label;

  IF p_creator_option_index IS NOT NULL THEN
    SELECT id INTO v_option_id
    FROM public.bet_options
    WHERE bet_id = v_bet_id AND sort_order = p_creator_option_index;

    PERFORM public.place_option_wager(
      v_bet_id,
      v_option_id,
      p_creator_amount
    );
  END IF;

  RETURN v_bet_id;
END;
$$;

CREATE FUNCTION public.propose_option_resolution(
  p_bet_id UUID,
  p_option_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_resolution_id UUID;
  v_option_sort SMALLINT;
  v_legacy_side TEXT;
  v_bet_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_bet_participant(p_bet_id, v_user_id) THEN
    RAISE EXCEPTION 'Only participants can propose a resolution';
  END IF;
  SELECT status INTO v_bet_status
  FROM public.bets
  WHERE id = p_bet_id
  FOR UPDATE;

  IF NOT FOUND OR v_bet_status <> 'locked' THEN
    RAISE EXCEPTION 'Bet must be locked before proposing a resolution';
  END IF;

  SELECT sort_order INTO v_option_sort
  FROM public.bet_options
  WHERE id = p_option_id AND bet_id = p_bet_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid option';
  END IF;

  v_legacy_side :=
    CASE v_option_sort WHEN 0 THEN 'a' WHEN 1 THEN 'b' ELSE NULL END;

  INSERT INTO public.resolutions (
    bet_id,
    proposed_by,
    proposed_winner_option_id,
    proposed_winner_side
  )
  VALUES (
    p_bet_id,
    v_user_id,
    p_option_id,
    v_legacy_side
  )
  RETURNING id INTO v_resolution_id;

  UPDATE public.bets
  SET status = 'resolving'
  WHERE id = p_bet_id;

  RETURN v_resolution_id;
END;
$$;

CREATE FUNCTION public.confirm_option_resolution(
  p_resolution_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_bet_id UUID;
  v_proposed_by UUID;
  v_winner_option_id UUID;
  v_win_total NUMERIC;
  v_lose_total NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT r.bet_id, r.proposed_by, r.proposed_winner_option_id
  INTO v_bet_id, v_proposed_by, v_winner_option_id
  FROM public.resolutions r
  JOIN public.bets b ON b.id = r.bet_id
  WHERE r.id = p_resolution_id
    AND r.status = 'pending'
    AND b.status = 'resolving'
  FOR UPDATE OF r, b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolution not found or already resolved';
  END IF;
  IF v_user_id = v_proposed_by THEN
    RAISE EXCEPTION 'Another participant must confirm the resolution';
  END IF;
  IF NOT public.is_bet_participant(v_bet_id, v_user_id) THEN
    RAISE EXCEPTION 'Only participants can confirm the resolution';
  END IF;
  IF v_winner_option_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.bet_options
    WHERE id = v_winner_option_id AND bet_id = v_bet_id
  ) THEN
    RAISE EXCEPTION 'Invalid winning option';
  END IF;

  UPDATE public.resolutions
  SET status = 'confirmed', confirmed_by = v_user_id, resolved_at = NOW()
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

  -- No winner or no losing pool means every wager is refunded: no IOUs.
  IF v_win_total = 0 OR v_lose_total = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.iou_ledger
    (bet_id, creditor_id, debtor_id, amount)
  SELECT
    v_bet_id,
    winner.user_id,
    loser.user_id,
    ROUND(loser.amount * (winner.amount / v_win_total), 2)
  FROM public.bet_participants winner
  JOIN public.bet_participants loser
    ON loser.bet_id = winner.bet_id
    AND loser.option_id <> winner.option_id
  WHERE winner.bet_id = v_bet_id
    AND winner.option_id = v_winner_option_id;
END;
$$;

-- Atomic compatibility entry point used while the app flag is still off.
CREATE FUNCTION public.propose_legacy_resolution(
  p_bet_id UUID,
  p_side TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_option_id UUID;
BEGIN
  IF p_side NOT IN ('a', 'b') THEN
    RAISE EXCEPTION 'Invalid side';
  END IF;

  SELECT id INTO v_option_id
  FROM public.bet_options
  WHERE bet_id = p_bet_id
    AND sort_order = CASE p_side WHEN 'a' THEN 0 ELSE 1 END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Legacy option not found';
  END IF;

  RETURN public.propose_option_resolution(p_bet_id, v_option_id);
END;
$$;

CREATE FUNCTION public.dispute_option_resolution(
  p_resolution_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_bet_id UUID;
  v_proposed_by UUID;
  v_dispute_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT r.bet_id, r.proposed_by
  INTO v_bet_id, v_proposed_by
  FROM public.resolutions r
  JOIN public.bets b ON b.id = r.bet_id
  WHERE r.id = p_resolution_id
    AND r.status = 'pending'
    AND b.status = 'resolving'
  FOR UPDATE OF r, b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolution not found or not pending';
  END IF;
  IF v_user_id = v_proposed_by THEN
    RAISE EXCEPTION 'Another participant must dispute the resolution';
  END IF;
  IF NOT public.is_bet_participant(v_bet_id, v_user_id) THEN
    RAISE EXCEPTION 'Only participants can dispute the resolution';
  END IF;

  UPDATE public.resolutions
  SET status = 'disputed', resolved_at = NOW()
  WHERE id = p_resolution_id;

  SELECT COUNT(*) INTO v_dispute_count
  FROM public.resolutions
  WHERE bet_id = v_bet_id AND status = 'disputed';

  UPDATE public.bets
  SET status = CASE WHEN v_dispute_count >= 3 THEN 'stuck' ELSE 'locked' END
  WHERE id = v_bet_id;
END;
$$;

-- Existing app RPCs stay available only to the trusted server client.
REVOKE ALL ON FUNCTION public.place_wager(UUID, UUID, TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_wager(UUID, UUID, TEXT, NUMERIC)
  TO service_role;

REVOKE ALL ON FUNCTION public.confirm_resolution(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_resolution(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.dispute_resolution(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispute_resolution(UUID, UUID)
  TO service_role;

-- New primitives are callable only with an authenticated user JWT.
REVOKE ALL ON FUNCTION public.place_option_wager(UUID, UUID, NUMERIC)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_option_wager(UUID, UUID, NUMERIC)
  TO authenticated;

REVOKE ALL ON FUNCTION public.create_bet_with_options(
  TEXT, TEXT, TEXT[], NUMERIC, NUMERIC, TIMESTAMPTZ, INTEGER, NUMERIC
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_bet_with_options(
  TEXT, TEXT, TEXT[], NUMERIC, NUMERIC, TIMESTAMPTZ, INTEGER, NUMERIC
) TO authenticated;

REVOKE ALL ON FUNCTION public.propose_option_resolution(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_option_resolution(UUID, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.propose_legacy_resolution(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_legacy_resolution(UUID, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_option_resolution(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_option_resolution(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.dispute_option_resolution(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispute_option_resolution(UUID)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
