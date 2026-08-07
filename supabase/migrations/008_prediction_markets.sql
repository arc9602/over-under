-- Prediction markets: Kalshi-style binary contracts traded on a central limit
-- order book, added ALONGSIDE pooled bets (nothing about bets changes).
--
-- The economics that make this fit an IOU app with no escrow: a matched trade
-- is already an IOU. If A buys YES at 62c and B buys NO at 38c for 10
-- contracts, then on YES the NO holder owes 38c x 10 = $3.80, and on NO the
-- YES holder owes 62c x 10 = $6.20. Every fill is a peer-to-peer bet whose
-- loser pays exactly the loser's own stake -- no house, no liquidity provider.
--
-- There is no explicit sell. In a binary market "sell 10 YES @ 65c" IS
-- "buy 10 NO @ 35c", so exiting = buying the opposite side, and the offsetting
-- fills net out at settlement. That avoids transferring an IOU obligation to a
-- third party, which has no sane representation in this ledger.

-- ============================================================
-- 1. Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.markets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code   TEXT UNIQUE NOT NULL DEFAULT substr(md5(random()::text), 1, 10),
  title         TEXT NOT NULL,
  description   TEXT,
  yes_label     TEXT NOT NULL DEFAULT 'Yes',
  no_label      TEXT NOT NULL DEFAULT 'No',
  currency      TEXT NOT NULL DEFAULT 'USD',
  deadline      TIMESTAMPTZ,
  -- Optional cap on how many contracts one person may hold per side. The
  -- analogue of bets.max_wager.
  max_contracts INT CHECK (max_contracts IS NULL OR max_contracts > 0),
  -- Cents, last traded YES price. Denormalized so the card/list views don't
  -- have to aggregate fills.
  last_price    INT CHECK (last_price IS NULL OR last_price BETWEEN 1 AND 99),
  -- Deliberately the same vocabulary as bets.status so BetStatusBadge and the
  -- dashboard tab groupings work unchanged. open = no fills yet, active = has
  -- traded, locked = trading halted and resting orders cancelled.
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','active','locked','resolving','resolved','cancelled','expired','stuck')),
  creator_id    UUID NOT NULL REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.market_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id       UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.profiles(id),
  side            TEXT NOT NULL CHECK (side IN ('yes','no')),
  -- 1..99, not 0..99: a 0c order risks nothing and could only match a 100c
  -- counterparty, which is equally excluded. 99c YES vs 1c NO is the extreme
  -- tradeable pair.
  limit_price     INT NOT NULL CHECK (limit_price BETWEEN 1 AND 99),
  quantity        INT NOT NULL CHECK (quantity > 0),
  filled_quantity INT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','cancelled')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT market_orders_fill_range_chk CHECK (filled_quantity >= 0 AND filled_quantity <= quantity)
);

-- The paired-position record, and the sole input to settlement.
-- no_price is implicitly 100 - yes_price.
CREATE TABLE IF NOT EXISTS public.market_fills (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id    UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  yes_user_id  UUID NOT NULL REFERENCES public.profiles(id),
  no_user_id   UUID NOT NULL REFERENCES public.profiles(id),
  yes_price    INT NOT NULL CHECK (yes_price BETWEEN 1 AND 99),
  quantity     INT NOT NULL CHECK (quantity > 0),
  yes_order_id UUID REFERENCES public.market_orders(id),
  no_order_id  UUID REFERENCES public.market_orders(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT market_fills_distinct_users_chk CHECK (yes_user_id <> no_user_id)
);

CREATE TABLE IF NOT EXISTS public.market_resolutions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id         UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  proposed_by       UUID NOT NULL REFERENCES public.profiles(id),
  proposed_outcome  TEXT NOT NULL CHECK (proposed_outcome IN ('yes','no')),
  confirmed_by      UUID REFERENCES public.profiles(id),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','disputed','superseded')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);

-- indexes
CREATE INDEX IF NOT EXISTS markets_creator_idx ON public.markets(creator_id);
CREATE INDEX IF NOT EXISTS markets_invite_code_idx ON public.markets(invite_code);
-- The matching hot path: resting orders on one side of one market, best price first.
CREATE INDEX IF NOT EXISTS market_orders_book_idx
  ON public.market_orders(market_id, side, status, limit_price DESC, created_at);
CREATE INDEX IF NOT EXISTS market_orders_user_idx ON public.market_orders(user_id);
CREATE INDEX IF NOT EXISTS market_fills_market_idx ON public.market_fills(market_id);
CREATE INDEX IF NOT EXISTS market_fills_yes_user_idx ON public.market_fills(yes_user_id);
CREATE INDEX IF NOT EXISTS market_fills_no_user_idx ON public.market_fills(no_user_id);
CREATE INDEX IF NOT EXISTS market_resolutions_market_idx ON public.market_resolutions(market_id);

-- ============================================================
-- 2. iou_ledger: accept a market as the source of an IOU
-- ============================================================
-- The only change to an existing table. getIouLedger / getNetBalancesForUser
-- never reference bet_id, so /balances and settle-up pick up market IOUs with
-- no application changes at all.

ALTER TABLE public.iou_ledger ALTER COLUMN bet_id DROP NOT NULL;
ALTER TABLE public.iou_ledger ADD COLUMN IF NOT EXISTS market_id UUID REFERENCES public.markets(id);
ALTER TABLE public.iou_ledger ADD CONSTRAINT iou_ledger_source_chk
  CHECK (num_nonnulls(bet_id, market_id) = 1);
CREATE INDEX IF NOT EXISTS iou_ledger_market_idx ON public.iou_ledger(market_id);

-- ============================================================
-- 3. RLS
-- ============================================================

ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_fills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_resolutions ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER so the policies below don't re-trigger themselves -- same
-- recursion fix as is_bet_participant in 004_fix_rls_recursion.sql. The
-- creator counts as a participant even before they place an order, otherwise
-- they couldn't see (or resolve) a market nobody has traded yet.
CREATE OR REPLACE FUNCTION public.can_access_market(p_market_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.markets m
    WHERE m.id = p_market_id AND m.creator_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.market_orders o
    WHERE o.market_id = p_market_id AND o.user_id = p_user_id
  );
$$;

-- Every policy is DROP-then-CREATE so this section can be re-run on its own,
-- matching the convention in 004 and 006. A bare CREATE POLICY aborts on the
-- second run, which silently leaves RLS enabled with no policy behind it --
-- and a table in that state rejects every write.
-- The `auth.uid() = creator_id` disjunct is load-bearing, not a shortcut.
-- createMarket inserts with .select("id"), which makes it INSERT ... RETURNING,
-- and Postgres applies SELECT policies to returned rows -- failing one raises
-- the same "new row violates row-level security policy" error as a failed
-- WITH CHECK. can_access_market is STABLE and re-queries public.markets, so it
-- cannot see the row the current statement is inserting and would return false
-- for every brand-new market. Testing creator_id directly against the new
-- row's own column passes immediately. This is exactly why the bets policy in
-- 004 is shaped `auth.uid() = creator_id OR is_bet_participant(...)`.
DROP POLICY IF EXISTS "Participants can read markets" ON public.markets;
CREATE POLICY "Participants can read markets"
  ON public.markets FOR SELECT
  USING (
    auth.uid() = creator_id
    OR public.can_access_market(id, auth.uid())
  );

DROP POLICY IF EXISTS "Authenticated users can create markets" ON public.markets;
CREATE POLICY "Authenticated users can create markets"
  ON public.markets FOR INSERT WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Creator can update markets" ON public.markets;
CREATE POLICY "Creator can update markets"
  ON public.markets FOR UPDATE USING (auth.uid() = creator_id);

-- The whole book is visible to everyone in the market -- that's what makes it
-- a market. No INSERT/UPDATE policy: all writes go through the SECURITY
-- DEFINER RPCs below, the same convention 006 adopted for bet_participants.
DROP POLICY IF EXISTS "Participants can read market_orders" ON public.market_orders;
CREATE POLICY "Participants can read market_orders"
  ON public.market_orders FOR SELECT
  USING (public.can_access_market(market_id, auth.uid()));

DROP POLICY IF EXISTS "Participants can read market_fills" ON public.market_fills;
CREATE POLICY "Participants can read market_fills"
  ON public.market_fills FOR SELECT
  USING (public.can_access_market(market_id, auth.uid()));

DROP POLICY IF EXISTS "Participants can read market_resolutions" ON public.market_resolutions;
CREATE POLICY "Participants can read market_resolutions"
  ON public.market_resolutions FOR SELECT
  USING (public.can_access_market(market_id, auth.uid()));

DROP POLICY IF EXISTS "Participants can insert market_resolutions" ON public.market_resolutions;
CREATE POLICY "Participants can insert market_resolutions"
  ON public.market_resolutions FOR INSERT
  WITH CHECK (
    auth.uid() = proposed_by
    AND public.can_access_market(market_id, auth.uid())
  );

DROP POLICY IF EXISTS "Participants can update market_resolutions" ON public.market_resolutions;
CREATE POLICY "Participants can update market_resolutions"
  ON public.market_resolutions FOR UPDATE
  USING (public.can_access_market(market_id, auth.uid()));

-- ============================================================
-- 4. Matching engine
-- ============================================================

-- Places a limit order, matches it against the resting book, and rests any
-- remainder. Returns what actually happened so the UI can report the fill.
--
-- Pricing rule: the RESTING order always transacts at its own limit price and
-- the aggressor pays the complement. The aggressor therefore never pays more
-- than its limit and often less (price improvement), which is standard
-- price-time priority behavior.
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
  IF p_side NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'Invalid side';
  END IF;
  IF p_limit_price IS NULL OR p_limit_price < 1 OR p_limit_price > 99 THEN
    RAISE EXCEPTION 'Price must be between 1c and 99c';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be at least 1 contract';
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

-- Cancels the unfilled remainder of an order. Fills already made are permanent.
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

-- Creator halts trading. Resting orders can't survive a halt -- unmatched
-- interest at lock time would never get a counterparty.
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

-- ============================================================
-- 5. Settlement
-- ============================================================

-- Mirrors confirm_resolution (006) but the payout rule is simply "the losing
-- side of each fill owes its own stake". Amounts are summed in integer cents
-- and rounded once per counterparty pair, so there's none of the per-row
-- NUMERIC(10,2) drift the pooled-bet version has to tolerate.
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
BEGIN
  SELECT r.market_id, r.proposed_outcome
  INTO v_market_id, v_outcome
  FROM public.market_resolutions r
  WHERE r.id = p_resolution_id AND r.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolution not found or already resolved';
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
