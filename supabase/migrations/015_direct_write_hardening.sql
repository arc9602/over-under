BEGIN;

-- ============================================================
-- Closing the last direct-write paths left open to `authenticated`.
--
-- The convention every migration from 006 onward has followed is that a
-- state transition which decides who gets paid belongs in a SECURITY DEFINER
-- RPC, never in an RLS policy -- because a policy can only say WHICH ROWS a
-- role may touch, never WHICH COLUMNS or WHICH TRANSITIONS. 009 applied that
-- to `resolutions`. This migration applies it to the three places it was
-- never applied: market_resolutions, settlements, and the status columns of
-- bets/markets.
--
-- Nothing here removes capability from the application. Every write these
-- revokes block is already performed somewhere else through the service-role
-- client or an RPC; the grep to confirm that is noted against each one.
-- ============================================================


-- ============================================================
-- 1. market_resolutions: drop the UPDATE policy (the important one)
-- ============================================================
-- 008 created:
--
--   CREATE POLICY "Participants can update market_resolutions"
--     ON public.market_resolutions FOR UPDATE
--     USING (public.can_access_market(market_id, auth.uid()));
--
-- and 009 dropped the equivalent policy on `resolutions` ("Resolution state
-- transitions and payouts must only happen through RPCs") without dropping
-- this one. The gap is directly monetizable, and it does not require any
-- special position -- one resting order in the market is enough to satisfy
-- can_access_market:
--
--   1. An honest trader proposes the correct outcome. The row is 'pending'.
--   2. The attacker, who is merely *a* trader in the same market, sends
--        PATCH /rest/v1/market_resolutions?id=eq.<row>
--        {"proposed_outcome": "<the outcome that pays the attacker>"}
--      The policy above allows it: the row is in a market they can access.
--      Nothing checks that they are the proposer, because UPDATE policies
--      cannot express "and don't touch that column".
--   3. The attacker calls confirm_market_resolution normally. Every guard in
--      it passes -- they are a trader, and they are NOT the proposer, so the
--      self-confirmation check is satisfied. It reads proposed_outcome off
--      the row it was just handed and writes the iou_ledger from it.
--
-- The result is a settled market paying the outcome the attacker chose,
-- through an RPC that behaved exactly as designed. The authorization was
-- never bypassed; the *input* to it was rewritten underneath.
--
-- The same policy also allows setting status directly ('confirmed' with no
-- payout, or off 'pending' entirely), which strands a market forever: every
-- one of confirm/dispute requires status = 'pending' to proceed.
--
-- Safe to drop -- no user-client UPDATE of this table exists:
--   proposeMarketResolution  INSERT via the user client (policy kept below)
--   confirm/disputeMarketResolution  RPC via the service client
--   /api/markets/[id]/settle         service client
DROP POLICY IF EXISTS "Participants can update market_resolutions"
  ON public.market_resolutions;

-- The INSERT policy stays: proposing is the one resolution write the user
-- client legitimately makes, and its WITH CHECK already pins proposed_by to
-- auth.uid() and requires market access.


-- ============================================================
-- 2. settlements: drop the INSERT policy
-- ============================================================
-- "Users can create settlements" (002) lets any user POST a settlements row
-- claiming they paid anyone any amount. markSettled is the only writer and
-- it goes through the service client *after* checking the amount against
-- what the caller actually owes -- a check the policy cannot express, which
-- is the whole reason iou_ledger has no write policy either.
--
-- A forged row does not clear debt on its own (getNetBalancesForUser reads
-- iou_ledger, not settlements), but settlements is the payment record the
-- ledger is reconciled against, and a table anyone can write is not a record.
DROP POLICY IF EXISTS "Users can create settlements" ON public.settlements;


-- ============================================================
-- 3. bets / markets / profiles: column-level UPDATE grants
-- ============================================================
-- "Creator can update bets" (006) and "Creator can update markets" (008) are
-- correct about WHICH ROWS, and silent about WHICH COLUMNS -- so a creator
-- can PATCH the title, the labels, the deadline, or max_contracts of a market
-- people have already traded on. Rewriting the question after the wagers are
-- in is the oldest trick there is, and RLS has no way to stop it.
--
-- Column grants do. Postgres checks them independently of RLS, so this is a
-- second, orthogonal gate rather than a longer policy expression. The columns
-- granted are exactly the ones the app writes through the user client:
--
--   cancelBet / lockBet     lib/actions/bets.ts    -> bets.status
--   cancelMarket            lib/actions/markets.ts -> markets.status
--   updateProfile           lib/actions/profile.ts -> username, display_name
--
-- service_role is untouched by a revoke from authenticated/anon, so every
-- RPC and every route handler keeps working unchanged.

REVOKE UPDATE ON public.bets     FROM anon, authenticated;
REVOKE UPDATE ON public.markets  FROM anon, authenticated;
REVOKE UPDATE ON public.profiles FROM anon, authenticated;

GRANT UPDATE (status) ON public.bets    TO authenticated;
GRANT UPDATE (status) ON public.markets TO authenticated;
GRANT UPDATE (username, display_name, avatar_url) ON public.profiles TO authenticated;


-- ============================================================
-- 4. Status transitions from the user client
-- ============================================================
-- Section 3 narrows a creator to the status column. This narrows what they
-- may set it to, which is the part that still moves money: 'resolved' is the
-- state confirm_resolution / confirm_market_resolution reach *after* writing
-- the iou_ledger, so a creator setting it directly produces a market that
-- looks settled and paid nobody -- and, since /api/markets/[id]/settle
-- refuses anything already 'resolved', can never afterwards be settled
-- against the USDC escrow either. Every dollar locked against it stays
-- locked.
--
-- Enforced only when auth.uid() IS NOT NULL. That is the same boundary
-- migration 014 reasons about: the service-role client and every SECURITY
-- DEFINER function invoked through it run with no JWT, so auth.uid() is NULL
-- and the guard steps aside. It applies to exactly one caller -- a direct
-- PostgREST write from a signed-in user -- which is what it is for.
--
-- Deliberately allowlisted rather than denylisted: a status added by a later
-- migration is unreachable from the user client until someone adds it here on
-- purpose, which is the direction this should fail in.

CREATE OR REPLACE FUNCTION public.guard_user_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Not an end-user write: service role, or a SECURITY DEFINER function
  -- called through it. Those are the trusted paths and they own the states
  -- this trigger refuses.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- The two transitions the app performs through the user client:
  --   cancel  (open|active) -> cancelled
  --   lock     active       -> locked
  IF OLD.status IN ('open', 'active') AND NEW.status IN ('cancelled', 'locked') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Status % -> % is not a permitted direct transition; it must go through its resolution function',
    OLD.status, NEW.status
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS bets_guard_status_transition ON public.bets;
CREATE TRIGGER bets_guard_status_transition
  BEFORE UPDATE ON public.bets
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_status_transition();

DROP TRIGGER IF EXISTS markets_guard_status_transition ON public.markets;
CREATE TRIGGER markets_guard_status_transition
  BEFORE UPDATE ON public.markets
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_status_transition();

REVOKE ALL ON FUNCTION public.guard_user_status_transition() FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 5. Cancelling an order releases its escrow
-- ============================================================
-- lock_usdc_escrow (014) takes the stake at order placement and records the
-- lock against order_id. release_usdc_escrow was wired into exactly two
-- places -- the compensating path in /api/bets/place, and settlement -- so a
-- cancelled order left its escrow 'open'. The money is not lost (settlement
-- returns it as residual), but it stays unspendable until the market
-- resolves, which for a cancelled order is arbitrarily long and for a market
-- that never resolves is forever.
--
-- Released inside cancel_market_order rather than in the TypeScript caller so
-- it shares that function's transaction: the order does not come off the book
-- unless the stake comes out of escrow with it.
--
-- Body is otherwise migration 011's verbatim, including its caller-identity
-- guard.
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
  v_lock_id UUID;
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

  -- Ownership is already proven above, and the lock is matched on order_id,
  -- so this cannot release someone else's escrow. Orders placed before 014 --
  -- or through the non-escrowed server action -- simply have no lock, and the
  -- loop body never runs.
  FOR v_lock_id IN
    SELECT id FROM public.usdc_escrow_locks
    WHERE order_id = p_order_id AND user_id = p_user_id AND status = 'open'
  LOOP
    PERFORM public.release_usdc_escrow(v_lock_id);
  END LOOP;
END;
$$;

-- Reachable only through the service client (lib/actions/markets.ts's
-- cancelMarketOrder is the sole caller), so `authenticated` has no use for
-- EXECUTE here. Matching 014's convention: the caller-identity guard above
-- constrains WHO this acts for, and the revoke constrains who can invoke it
-- at all -- two different questions, both worth answering.
REVOKE ALL ON FUNCTION public.cancel_market_order(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

COMMIT;


-- ============================================================
-- Verification. Run after COMMIT, not inside it.
-- ============================================================

-- 1. No write policies survive on the resolution/settlement tables. Expect
--    only the INSERT policy on market_resolutions.
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('market_resolutions', 'resolutions', 'settlements')
-- ORDER BY tablename, cmd;

-- 2. authenticated holds UPDATE on the intended columns only. Expect
--    bets.status, markets.status, profiles.{username,display_name,avatar_url}.
-- SELECT table_name, column_name FROM information_schema.column_privileges
-- WHERE grantee = 'authenticated' AND privilege_type = 'UPDATE'
--   AND table_schema = 'public'
-- ORDER BY table_name, column_name;

-- 3. Escrow locks reconcile against the escrow bucket -- same query as 014's
--    reconciliation 4, which should now also hold after a cancellation.
-- SELECT a.user_id, a.escrow, COALESCE(SUM(e.amount), 0) AS open_locks
-- FROM public.usdc_accounts a
-- LEFT JOIN public.usdc_escrow_locks e ON e.user_id = a.user_id AND e.status = 'open'
-- GROUP BY a.user_id, a.escrow
-- HAVING a.escrow <> COALESCE(SUM(e.amount), 0);
