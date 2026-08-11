BEGIN;

-- ============================================================
-- CRITICAL: every SECURITY DEFINER function that takes an "acting user"
-- parameter (p_user_id / p_confirmer_id / p_disputer_id) trusted that
-- parameter directly instead of verifying it against auth.uid(). Postgres
-- grants EXECUTE on a new function to PUBLIC by default, there is no REVOKE
-- anywhere in this project's history, and Supabase exposes every public
-- schema function over PostgREST to the anon/authenticated roles. That
-- means any authenticated user could call e.g. place_wager or
-- confirm_resolution directly against the REST API with someone else's
-- UUID as the acting party, completely bypassing this app's own
-- session-derived checks -- not a frontend bug, a database one.
--
-- Fixed with one guard per function: `IF p_user_id <> auth.uid() THEN
-- RAISE EXCEPTION`. This app's own server actions call these RPCs through
-- the service-role client (see lib/supabase/server.ts#createServiceClient),
-- under which auth.uid() is NULL -- and `x <> NULL` evaluates to NULL, which
-- PL/pgSQL's IF treats as false, same as FALSE. So the guard is a no-op for
-- this app's legitimate service-role calls and a hard rejection for anyone
-- calling with a real session JWT whose identity doesn't match the
-- parameter they're claiming to act as.
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

CREATE OR REPLACE FUNCTION public.place_market_order(
  p_market_id UUID,
  p_user_id UUID,
  p_side TEXT,
  p_limit_price INT,
  p_quantity INT
)
-- The OUT column names are deliberately NOT filled_quantity/quantity: a plpgsql
-- OUT parameter sharing a name with a column makes every reference to that
-- column inside the body ambiguous at runtime.
RETURNS TABLE(filled_qty INT, resting_qty INT, avg_price_cents INT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_max_contracts INT;
  v_held INT;
  v_order_id UUID;
  v_remaining INT := p_quantity;
  v_filled INT := 0;
  v_cost_cents INT := 0;
  v_last_yes_price INT;
  v_resting RECORD;
  v_fill_qty INT;
  v_yes_price INT;
  v_my_price INT;
BEGIN
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;
  IF p_side NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'Invalid side';
  END IF;
  IF p_limit_price IS NULL OR p_limit_price < 1 OR p_limit_price > 99 THEN
    RAISE EXCEPTION 'Price must be between 1c and 99c';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be at least 1 contract';
  END IF;

  IF NOT public.check_rate_limit(p_user_id, 'place_market_order', 30, 60) THEN
    RAISE EXCEPTION 'Too many orders placed -- wait a moment and try again';
  END IF;

  -- Lock the market row. Every order on this market serializes here, which is
  -- what makes the match loop below safe without locking the whole book.
  SELECT m.status, m.max_contracts INTO v_status, v_max_contracts
  FROM public.markets m WHERE m.id = p_market_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_status NOT IN ('open', 'active') THEN
    RAISE EXCEPTION 'This market is no longer accepting orders';
  END IF;

  -- Position cap counts contracts already held on this side plus anything of
  -- the user's still resting on this side, so you can't sidestep it by
  -- splitting into many resting orders.
  IF v_max_contracts IS NOT NULL THEN
    SELECT COALESCE((
      SELECT SUM(f.quantity) FROM public.market_fills f
      WHERE f.market_id = p_market_id
        AND ((p_side = 'yes' AND f.yes_user_id = p_user_id)
          OR (p_side = 'no'  AND f.no_user_id  = p_user_id))
    ), 0) + COALESCE((
      SELECT SUM(o.quantity - o.filled_quantity) FROM public.market_orders o
      WHERE o.market_id = p_market_id AND o.user_id = p_user_id
        AND o.side = p_side AND o.status = 'open'
    ), 0)
    INTO v_held;

    IF v_held + p_quantity > v_max_contracts THEN
      RAISE EXCEPTION 'This market caps you at % contracts per side (you already have %)',
        v_max_contracts, v_held;
    END IF;
  END IF;

  INSERT INTO public.market_orders (market_id, user_id, side, limit_price, quantity)
  VALUES (p_market_id, p_user_id, p_side, p_limit_price, p_quantity)
  RETURNING id INTO v_order_id;

  FOR v_resting IN
    SELECT o.id, o.user_id, o.side, o.limit_price, o.quantity, o.filled_quantity
    FROM public.market_orders o
    WHERE o.market_id = p_market_id
      AND o.status = 'open'
      AND o.side <> p_side
      -- Never match a user against themselves: it would mint an IOU they owe
      -- to themselves.
      AND o.user_id <> p_user_id
      -- The crossing condition: the two limits must sum to at least a dollar.
      AND o.limit_price >= 100 - p_limit_price
    ORDER BY o.limit_price DESC, o.created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_fill_qty := LEAST(v_remaining, v_resting.quantity - v_resting.filled_quantity);
    CONTINUE WHEN v_fill_qty <= 0;

    v_yes_price := CASE
      WHEN v_resting.side = 'yes' THEN v_resting.limit_price
      ELSE 100 - v_resting.limit_price
    END;

    INSERT INTO public.market_fills (
      market_id, yes_user_id, no_user_id, yes_price, quantity, yes_order_id, no_order_id
    ) VALUES (
      p_market_id,
      CASE WHEN p_side = 'yes' THEN p_user_id ELSE v_resting.user_id END,
      CASE WHEN p_side = 'yes' THEN v_resting.user_id ELSE p_user_id END,
      v_yes_price,
      v_fill_qty,
      CASE WHEN p_side = 'yes' THEN v_order_id ELSE v_resting.id END,
      CASE WHEN p_side = 'yes' THEN v_resting.id ELSE v_order_id END
    );

    UPDATE public.market_orders
    SET filled_quantity = filled_quantity + v_fill_qty,
        status = CASE WHEN filled_quantity + v_fill_qty >= quantity THEN 'filled' ELSE 'open' END
    WHERE id = v_resting.id;

    v_my_price := CASE WHEN p_side = 'yes' THEN v_yes_price ELSE 100 - v_yes_price END;
    v_cost_cents := v_cost_cents + (v_my_price * v_fill_qty);
    v_filled := v_filled + v_fill_qty;
    v_remaining := v_remaining - v_fill_qty;
    v_last_yes_price := v_yes_price;
  END LOOP;

  UPDATE public.market_orders
  SET filled_quantity = v_filled,
      status = CASE WHEN v_filled >= p_quantity THEN 'filled' ELSE 'open' END
  WHERE id = v_order_id;

  IF v_filled > 0 THEN
    UPDATE public.markets
    SET last_price = v_last_yes_price,
        status = CASE WHEN status = 'open' THEN 'active' ELSE status END
    WHERE id = p_market_id;
  END IF;

  RETURN QUERY SELECT
    v_filled,
    v_remaining,
    CASE WHEN v_filled > 0 THEN ROUND(v_cost_cents::NUMERIC / v_filled)::INT ELSE NULL END;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_market_order(
  p_order_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_market_id UUID;
  v_owner UUID;
  v_status TEXT;
BEGIN
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;

  SELECT o.market_id, o.user_id, o.status INTO v_market_id, v_owner, v_status
  FROM public.market_orders o WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_owner <> p_user_id THEN
    RAISE EXCEPTION 'That is not your order';
  END IF;

  -- Take the same market lock the matcher takes, so an order can't be
  -- cancelled halfway through being filled.
  PERFORM 1 FROM public.markets WHERE id = v_market_id FOR UPDATE;

  UPDATE public.market_orders
  SET status = 'cancelled'
  WHERE id = p_order_id AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That order is no longer open';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_market(
  p_market_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_creator UUID;
  v_status TEXT;
BEGIN
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;

  SELECT m.creator_id, m.status INTO v_creator, v_status
  FROM public.markets m WHERE m.id = p_market_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_creator <> p_user_id THEN
    RAISE EXCEPTION 'Only the creator can lock this market';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'Only a market that has traded can be locked';
  END IF;

  UPDATE public.market_orders
  SET status = 'cancelled'
  WHERE market_id = p_market_id AND status = 'open';

  UPDATE public.markets SET status = 'locked' WHERE id = p_market_id;
END;
$$;

-- The four confirm/dispute functions below already got participant +
-- anti-self-confirmation checks in migration 010. This adds the caller-
-- identity guard on top -- 010 fixed "is this a legitimate confirmer for
-- this bet", this fixes "is the caller actually that confirmer".

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
  IF p_disputer_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;

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
  IF p_confirmer_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;

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
  IF p_disputer_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;

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
-- Rate limiting for financial endpoints: bet placement, order placement,
-- settlement. Postgres-backed rather than in-memory, because this app runs
-- on Cloudflare Workers -- there's no long-lived process to hold a counter
-- in memory, and every isolate would have its own copy anyway. A shared
-- table is the one thing every request already has access to.
--
-- Declared after place_wager/place_market_order above in this file only
-- because they're easier to read together with their identity fix, but
-- CREATE FUNCTION doesn't care about call-before-declare order within a
-- single transaction as long as everything resolves by COMMIT, so this is
-- safe to run in one shot.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID NOT NULL,
  action     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rate_limit_events_lookup_idx
  ON public.rate_limit_events (user_id, action, created_at);

-- RLS enabled with zero policies -- deliberately, not an oversight. With no
-- policy, RLS defaults to deny-all for anon/authenticated, which is exactly
-- what's wanted: this table is bookkeeping for check_rate_limit only, never
-- meant to be read or written directly over PostgREST. Without this, the
-- table would be reachable at /rest/v1/rate_limit_events regardless of what
-- check_rate_limit itself checks -- the same class of gap the caller-identity
-- fix above closes for the RPCs, just reachable a different way (direct
-- table access instead of a function call). check_rate_limit still works
-- fine: SECURITY DEFINER functions run as their owner, and table owners
-- bypass RLS on tables they own unless FORCE ROW LEVEL SECURITY is set
-- (it isn't here) -- same reason every other SECURITY DEFINER function in
-- this codebase already coexists with RLS-enabled tables like iou_ledger.
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

-- Sliding-window limiter: at most p_max_count calls per (user, action)
-- within the trailing p_window_seconds. Self-pruning (deletes its own old
-- rows each call), so the table never grows past what's inside the window
-- for however many distinct (user, action) pairs are actually active.
--
-- Same caller-identity guard as everything above: without it, an attacker
-- calling this directly could burn a victim's rate-limit budget as a denial
-- of service against their next legitimate wager/order.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id UUID,
  p_action TEXT,
  p_max_count INT,
  p_window_seconds INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_count INT;
BEGIN
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;

  -- Serializes concurrent calls for the same (user, action) so two requests
  -- racing at the count-then-insert boundary can't both slip through right
  -- at the limit. Scoped to this transaction; released automatically on
  -- commit or rollback, so it can't outlive the calling RPC's own lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_action, 0));

  DELETE FROM public.rate_limit_events
  WHERE user_id = p_user_id AND action = p_action
    AND created_at < NOW() - make_interval(secs => p_window_seconds);

  SELECT COUNT(*) INTO v_count
  FROM public.rate_limit_events
  WHERE user_id = p_user_id AND action = p_action;

  IF v_count >= p_max_count THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.rate_limit_events (user_id, action) VALUES (p_user_id, p_action);
  RETURN TRUE;
END;
$$;

COMMIT;
