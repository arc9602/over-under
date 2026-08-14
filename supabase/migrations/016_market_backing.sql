BEGIN;

-- ============================================================
-- A market is either IOU-backed or USDC-backed, decided once at creation,
-- and an order can only be placed through the path that matches.
--
-- The state this exists to make unreachable: a market containing fills from
-- BOTH order paths.
--
-- There are two ways to place an order today and they are not equivalent.
-- `placeMarketOrder` (lib/actions/markets.ts) calls place_market_order
-- directly and locks nothing. `/api/bets/place` calls lock_usdc_escrow first
-- and puts the order's max loss into the escrow bucket. Both produce
-- identical rows in market_fills, so by the time a market settles there is no
-- way to tell which fill had money behind it.
--
-- What that costs, concretely:
--
--   * A user with a zero USDC balance can take a real position through the
--     server action. confirm_market_resolution pays the winner out of
--     iou_ledger regardless of escrow, so being wrong costs them nothing they
--     ever deposited -- a free option written against the people who did.
--   * /api/markets/[id]/settle already refuses to settle such a market: its
--     `losingUnits > lockedUnits` guard 409s rather than consume escrow the
--     loser holds against some OTHER market. That guard is correct and it is
--     the reason this is a freeze rather than a theft. But it freezes every
--     honest trader's escrow in that market too, and one unbacked order is
--     enough to do it.
--
-- Rejected alternative: make every order escrow. That closes the hole and
-- also ends the deposit-free social flow the app was built around -- a user
-- who has never touched crypto could no longer take a position at all. The
-- exposure is not that IOU markets exist; it is that the two kinds mix.
-- So they stop mixing.
--
-- Enforcement lives in place_market_order rather than in the callers because
-- that function is the only thing that can write market_fills, and it takes
-- the market row lock while it does. A TypeScript check in front of it is a
-- check an attacker calls around.
-- ============================================================


-- ============================================================
-- 1. The column
-- ============================================================
-- Defaults to 'iou', which backfills every existing market correctly: they
-- were all created before escrow existed and none of them has a lock behind
-- it. A default of 'usdc' would retroactively claim funds that were never
-- taken.
ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS backing TEXT NOT NULL DEFAULT 'iou'
  CHECK (backing IN ('iou', 'usdc'));

COMMENT ON COLUMN public.markets.backing IS
  'iou = positions settle to iou_ledger, no funds held. usdc = every order '
  'escrows its max loss before it can rest or fill. Fixed at creation; see '
  'markets_backing_immutable.';

-- Immutable, with no role exemption -- not even service_role, which every
-- other guard in this schema deliberately steps aside for.
--
-- The reason it is absolute: flipping an existing market's backing does not
-- retroactively create or release escrow. 'iou' -> 'usdc' declares that
-- fills placed with nothing behind them are now funded, which is exactly the
-- lie this migration exists to prevent, and it would be told to the
-- settlement route by the database itself. There is no bug this setting fixes
-- and no migration that legitimately needs it; anything that genuinely must
-- change it can drop this trigger explicitly and own that decision in
-- writing.
CREATE OR REPLACE FUNCTION public.reject_market_backing_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.backing IS DISTINCT FROM OLD.backing THEN
    RAISE EXCEPTION
      'markets.backing is fixed at creation (% -> % on market %)',
      OLD.backing, NEW.backing, OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS markets_backing_immutable ON public.markets;
CREATE TRIGGER markets_backing_immutable
  BEFORE UPDATE ON public.markets
  FOR EACH ROW EXECUTE FUNCTION public.reject_market_backing_change();

REVOKE ALL ON FUNCTION public.reject_market_backing_change() FROM PUBLIC, anon, authenticated;

-- Creating a market is a user-client INSERT under the "Authenticated users
-- can create markets" policy. Supabase's default table-level grant already
-- covers every column, so this adds nothing today -- it is written down so
-- that narrowing INSERT on this table later (the way 015 narrowed UPDATE)
-- cannot silently take create-a-market with it.
--
-- Set on the way in, never afterwards: 015 revoked UPDATE down to the status
-- column alone, and markets_backing_immutable above refuses the change even
-- from service_role. That is the whole contract, enforced at three layers.
GRANT INSERT (backing) ON public.markets TO authenticated;


-- ============================================================
-- 2. place_market_order: the order path must match the backing
-- ============================================================
-- Gains one optional parameter, p_escrow_lock_id. Optional rather than
-- required so the existing PostgREST calls that pass five named arguments
-- keep resolving -- they simply arrive with NULL, which is precisely the
-- "no escrow behind this" case the checks below reject on a usdc market.
--
-- The pairing is enforced in both directions:
--
--   usdc market, no lock  -> rejected. This is the hole. Without it the
--                            server action places unbacked fills on a market
--                            whose other traders paid real money in.
--   iou market, has lock  -> also rejected, and not merely for symmetry:
--                            settlement of an IOU market never calls
--                            release_usdc_escrow, so a lock attached to one
--                            would hold that user's funds until someone
--                            noticed by hand.
--
-- Everything from the market row lock onward is migration 011's body
-- unchanged, including its caller-identity guard and rate limit. The two
-- additions are the backing/lock validation before the order row is created,
-- and the attachment of the lock to that row immediately after.
CREATE OR REPLACE FUNCTION public.place_market_order(
  p_market_id UUID,
  p_user_id UUID,
  p_side TEXT,
  p_limit_price INT,
  p_quantity INT,
  p_escrow_lock_id UUID DEFAULT NULL
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
  v_backing TEXT;
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
  v_lock public.usdc_escrow_locks;
  v_required NUMERIC;
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
  SELECT m.status, m.max_contracts, m.backing
  INTO v_status, v_max_contracts, v_backing
  FROM public.markets m WHERE m.id = p_market_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_status NOT IN ('open', 'active') THEN
    RAISE EXCEPTION 'This market is no longer accepting orders';
  END IF;

  -- ------------------------------------------------------------------
  -- Backing / escrow pairing. Before the order row exists, so a rejection
  -- here leaves no trace on the book and nothing to compensate.
  -- ------------------------------------------------------------------
  IF v_backing = 'usdc' AND p_escrow_lock_id IS NULL THEN
    RAISE EXCEPTION
      'This market requires USDC escrow -- place the order through /api/bets/place';
  END IF;
  IF v_backing <> 'usdc' AND p_escrow_lock_id IS NOT NULL THEN
    RAISE EXCEPTION
      'This market does not hold USDC -- an escrow lock here would never be released';
  END IF;

  IF p_escrow_lock_id IS NOT NULL THEN
    -- FOR UPDATE is what stops one lock backing two orders: a second
    -- concurrent call for the same lock blocks here and then fails the
    -- order_id IS NULL test below, rather than both reading it as unclaimed.
    SELECT * INTO v_lock FROM public.usdc_escrow_locks
    WHERE id = p_escrow_lock_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Escrow lock % not found', p_escrow_lock_id;
    END IF;
    -- Ownership, not just existence. Lock ids are opaque, but "unguessable"
    -- is not an authorization check, and this function runs SECURITY DEFINER
    -- with RLS off.
    IF v_lock.user_id <> p_user_id THEN
      RAISE EXCEPTION 'That escrow lock belongs to another account';
    END IF;
    IF v_lock.market_id IS DISTINCT FROM p_market_id THEN
      RAISE EXCEPTION 'That escrow lock is held against a different market';
    END IF;
    IF v_lock.status <> 'open' THEN
      RAISE EXCEPTION 'That escrow lock has already been released';
    END IF;
    IF v_lock.order_id IS NOT NULL THEN
      RAISE EXCEPTION 'That escrow lock already backs another order';
    END IF;

    -- The amount has to cover what this order can actually lose, or the
    -- escrow is decorative. Max loss is the own-side limit price times the
    -- quantity for BOTH sides -- a YES at p risks p, and a NO at p risks p,
    -- because p is what you pay per contract and a contract's floor is 0c.
    -- (lib/chain/amount.ts derives the same number the long way round, from
    -- the YES-denominated price; the two agree by construction.)
    --
    -- `>=` rather than `=`: the caller is free to over-escrow, and rounding
    -- can only ever go that direction. Under-escrowing is the failure that
    -- matters and it is refused.
    v_required := (p_limit_price::NUMERIC * p_quantity::NUMERIC) / 100;
    IF v_lock.amount < v_required THEN
      RAISE EXCEPTION
        'Escrow of % does not cover this order''s maximum loss of %',
        v_lock.amount, v_required
        USING ERRCODE = 'check_violation';
    END IF;
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

  -- Attached inside this transaction, which retires the best-effort
  -- "find my order by matching side/price/quantity and claim an unclaimed
  -- lock" search in /api/bets/place. That search was correct-by-accident --
  -- it relied on ambiguous candidates having identical escrow amounts -- and
  -- it could not run at all until after the order existed. Here the id is
  -- already in hand, and if anything below fails the attachment rolls back
  -- with the order.
  IF p_escrow_lock_id IS NOT NULL THEN
    UPDATE public.usdc_escrow_locks
    SET order_id = v_order_id
    WHERE id = p_escrow_lock_id;
  END IF;

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

-- The five-argument signature is gone -- CREATE OR REPLACE with a new DEFAULT
-- parameter leaves the old one behind as a separate overload, and an overload
-- that skips every check above is the hole this migration closes wearing a
-- different name. Dropped explicitly, after the replacement exists.
DROP FUNCTION IF EXISTS public.place_market_order(UUID, UUID, TEXT, INT, INT);

-- Same reachability boundary 014 established for the money functions, and for
-- the same reason: the checks above are only worth what the least-privileged
-- caller cannot route around. Every caller -- both call sites in
-- lib/actions/markets.ts and the /api/bets/place handler -- goes through the
-- service client, so `authenticated` losing EXECUTE costs nothing and closes
-- POST /rest/v1/rpc/place_market_order as a way to reach the matcher directly.
-- service_role holds its own grant and is unaffected by a revoke from these
-- two roles.
REVOKE ALL ON FUNCTION public.place_market_order(UUID, UUID, TEXT, INT, INT, UUID)
  FROM PUBLIC, anon, authenticated;

COMMIT;


-- ============================================================
-- Verification. Run after COMMIT, not inside it.
-- ============================================================

-- 1. Only the six-argument overload survives. Expect exactly one row.
-- SELECT p.oid::regprocedure AS signature
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'place_market_order';

-- 2. Every pre-existing market is IOU-backed. Expect zero rows -- a 'usdc'
--    market here would be one this migration invented backing for.
-- SELECT id, title, backing FROM public.markets
-- WHERE backing = 'usdc' AND created_at < NOW();

-- 3. The mixed-backing state is empty, which is the invariant this migration
--    buys. For every usdc market, every trader with fills must hold escrow.
--    Expect zero rows.
-- SELECT m.id AS market_id, u.user_id
-- FROM public.markets m
-- JOIN LATERAL (
--   SELECT f.yes_user_id AS user_id FROM public.market_fills f WHERE f.market_id = m.id
--   UNION
--   SELECT f.no_user_id  FROM public.market_fills f WHERE f.market_id = m.id
-- ) u ON TRUE
-- WHERE m.backing = 'usdc'
--   AND NOT EXISTS (
--     SELECT 1 FROM public.usdc_escrow_locks e
--     WHERE e.market_id = m.id AND e.user_id = u.user_id
--   );
