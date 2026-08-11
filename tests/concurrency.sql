-- ============================================================
-- Integration tests for the guarantees migration 014 makes.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/concurrency.sql
--
-- Run against a scratch database with migrations 001-014 applied. It creates
-- its own users, exercises them, and rolls everything back at the end -- but
-- point it at a throwaway database anyway, not production.
--
-- These live in SQL rather than in tests/amount.test.ts because what is under
-- test is not application code. Double-spend safety is a property of the row
-- lock inside move_usdc, and replay safety is a property of a UNIQUE index.
-- Neither can be exercised, or broken, from TypeScript -- and a mock that
-- "tests" them by stubbing the database would only assert that the mock
-- behaves the way the author assumed Postgres does, which is precisely the
-- assumption worth checking.
--
-- Section 4 is the real concurrency test and needs two sessions; it is a
-- procedure to run by hand rather than something this file can do alone.
-- ============================================================

BEGIN;

SET client_min_messages = WARNING;

-- ------------------------------------------------------------
-- Fixtures. profiles.id references auth.users, so the users have to exist
-- there first. The bets_create_options_on_insert / profiles_create_usdc_account
-- triggers do the rest.
-- ------------------------------------------------------------

CREATE TEMP TABLE t_ids (name TEXT PRIMARY KEY, id UUID NOT NULL);

DO $$
DECLARE
  v_alice UUID := gen_random_uuid();
  v_bob   UUID := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  VALUES (v_alice, 'alice@test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_bob,   'bob@test.invalid',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  INSERT INTO public.profiles (id, username) VALUES (v_alice, 'alice_t'), (v_bob, 'bob_t');

  INSERT INTO t_ids VALUES ('alice', v_alice), ('bob', v_bob);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.uid(p_name TEXT) RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT id FROM t_ids WHERE name = p_name $$;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_condition BOOLEAN, p_label TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition THEN
    RAISE NOTICE 'PASS  %', p_label;
  ELSE
    RAISE EXCEPTION 'FAIL  %', p_label;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 1. Accounts are auto-created, and start empty.
-- ------------------------------------------------------------

DO $$
BEGIN
  PERFORM pg_temp.ok(
    (SELECT COUNT(*) FROM public.usdc_accounts WHERE user_id IN (pg_temp.uid('alice'), pg_temp.uid('bob'))) = 2,
    'profiles trigger creates a usdc_accounts row per user');

  PERFORM pg_temp.ok(
    (SELECT available + escrow + withdrawal_pending FROM public.usdc_accounts WHERE user_id = pg_temp.uid('alice')) = 0,
    'a new account starts at zero across all three buckets');
END $$;

-- ------------------------------------------------------------
-- 2. Deposit replay protection.
--
-- The guarantee: the same transaction_hash cannot be credited twice, and the
-- second attempt does not partially apply. This is the UNIQUE constraint
-- doing the work -- there is deliberately no "have I seen this hash" SELECT
-- anywhere in the code path, since that is a TOCTOU race.
-- ------------------------------------------------------------

DO $$
DECLARE
  v_hash TEXT := '0x' || repeat('a', 64);
  v_before NUMERIC;
  v_after NUMERIC;
  v_replayed BOOLEAN := FALSE;
BEGIN
  PERFORM public.credit_usdc_deposit(
    pg_temp.uid('alice'), v_hash, '0x' || repeat('1', 40), 100.000000, 12345);

  SELECT available INTO v_before FROM public.usdc_accounts WHERE user_id = pg_temp.uid('alice');
  PERFORM pg_temp.ok(v_before = 100, 'first deposit credits the full amount');

  -- Replay the exact same hash. Must raise, and must leave the balance alone.
  BEGIN
    PERFORM public.credit_usdc_deposit(
      pg_temp.uid('alice'), v_hash, '0x' || repeat('1', 40), 100.000000, 12345);
  EXCEPTION WHEN unique_violation THEN
    v_replayed := TRUE;
  END;

  PERFORM pg_temp.ok(v_replayed, 'replaying a deposit hash raises unique_violation');

  SELECT available INTO v_after FROM public.usdc_accounts WHERE user_id = pg_temp.uid('alice');
  PERFORM pg_temp.ok(v_after = v_before,
    'a rejected replay leaves the balance untouched (no partial credit)');

  PERFORM pg_temp.ok(
    (SELECT COUNT(*) FROM public.usdc_deposits WHERE transaction_hash = v_hash) = 1,
    'exactly one deposit row survives the replay attempt');

  -- A DIFFERENT hash from the same sender is a legitimate second deposit.
  PERFORM public.credit_usdc_deposit(
    pg_temp.uid('alice'), '0x' || repeat('b', 64), '0x' || repeat('1', 40), 50.000000, 12346);

  PERFORM pg_temp.ok(
    (SELECT available FROM public.usdc_accounts WHERE user_id = pg_temp.uid('alice')) = 150,
    'a distinct hash from the same sender credits normally');
END $$;

-- ------------------------------------------------------------
-- 3. Overdraft protection.
--
-- Alice has 150. Escrowing more than that must fail, and must fail without
-- moving anything. Note this tests the SEQUENTIAL case -- the concurrent case
-- is section 4, and it is the row lock rather than this check that makes the
-- concurrent case safe.
-- ------------------------------------------------------------

DO $$
DECLARE
  v_blocked BOOLEAN := FALSE;
  v_avail NUMERIC;
  v_escrow NUMERIC;
BEGIN
  BEGIN
    PERFORM public.move_usdc('escrow_lock', pg_temp.uid('alice'), 'available',
                             pg_temp.uid('alice'), 'escrow', 150.000001);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;

  PERFORM pg_temp.ok(v_blocked, 'escrowing more than available is rejected');

  SELECT available, escrow INTO v_avail, v_escrow
  FROM public.usdc_accounts WHERE user_id = pg_temp.uid('alice');

  PERFORM pg_temp.ok(v_avail = 150 AND v_escrow = 0,
    'a rejected escrow leaves both buckets untouched');

  -- Spending exactly the whole balance is allowed; it is only the excess that
  -- is refused. Off-by-one at the boundary is the classic bug here.
  PERFORM public.move_usdc('escrow_lock', pg_temp.uid('alice'), 'available',
                           pg_temp.uid('alice'), 'escrow', 150.000000);

  SELECT available, escrow INTO v_avail, v_escrow
  FROM public.usdc_accounts WHERE user_id = pg_temp.uid('alice');
  PERFORM pg_temp.ok(v_avail = 0 AND v_escrow = 150, 'escrowing the exact balance succeeds');
END $$;

-- ------------------------------------------------------------
-- 4. Ledger invariants.
--
-- Every transaction nets to zero, the cache agrees with the ledger, and the
-- ledger is immutable. The first two are 014's reconciliation queries; the
-- third is what makes them meaningful.
-- ------------------------------------------------------------

DO $$
DECLARE
  v_unbalanced INT;
  v_drifted INT;
  v_immutable BOOLEAN := FALSE;
BEGIN
  SELECT COUNT(*) INTO v_unbalanced FROM (
    SELECT transaction_id FROM public.usdc_postings
    GROUP BY transaction_id HAVING SUM(amount) <> 0
  ) t;
  PERFORM pg_temp.ok(v_unbalanced = 0, 'every usdc transaction nets to zero');

  SELECT COUNT(*) INTO v_drifted FROM public.usdc_accounts a
  JOIN LATERAL (
    SELECT COALESCE(SUM(amount) FILTER (WHERE bucket = 'available'), 0) AS available,
           COALESCE(SUM(amount) FILTER (WHERE bucket = 'escrow'), 0) AS escrow,
           COALESCE(SUM(amount) FILTER (WHERE bucket = 'withdrawal_pending'), 0) AS withdrawal_pending
    FROM public.usdc_postings WHERE user_id = a.user_id
  ) l ON TRUE
  WHERE (a.available, a.escrow, a.withdrawal_pending)
     IS DISTINCT FROM (l.available, l.escrow, l.withdrawal_pending);
  PERFORM pg_temp.ok(v_drifted = 0, 'the accounts cache matches the ledger exactly');

  BEGIN
    UPDATE public.usdc_postings SET amount = amount + 1
    WHERE id = (SELECT id FROM public.usdc_postings LIMIT 1);
  EXCEPTION WHEN OTHERS THEN
    v_immutable := TRUE;
  END;
  PERFORM pg_temp.ok(v_immutable, 'ledger postings reject UPDATE (immutability trigger fires)');

  PERFORM pg_temp.ok(
    (SELECT -COALESCE(SUM(amount), 0) FROM public.usdc_postings WHERE bucket = 'external')
      = (SELECT SUM(available + escrow + withdrawal_pending) FROM public.usdc_accounts),
    'solvency: net deposited equals the sum of all user claims');
END $$;

-- ------------------------------------------------------------
-- 5. Settlement conservation.
--
-- Bob deposits, both escrow a stake, and the payout moves the loser's stake
-- to the winner. Total money must be unchanged.
-- ------------------------------------------------------------

DO $$
DECLARE
  v_total_before NUMERIC;
  v_total_after NUMERIC;
BEGIN
  PERFORM public.credit_usdc_deposit(
    pg_temp.uid('bob'), '0x' || repeat('c', 64), '0x' || repeat('2', 40), 3.800000, 12347);

  SELECT SUM(available + escrow + withdrawal_pending) INTO v_total_before FROM public.usdc_accounts;

  -- Bob escrows his 3.80 stake; Alice already has 150 escrowed from section 3.
  PERFORM public.move_usdc('escrow_lock', pg_temp.uid('bob'), 'available',
                           pg_temp.uid('bob'), 'escrow', 3.800000);

  -- Alice wins Bob's stake.
  PERFORM public.payout_usdc_escrow(pg_temp.uid('bob'), pg_temp.uid('alice'), 3.800000);

  SELECT SUM(available + escrow + withdrawal_pending) INTO v_total_after FROM public.usdc_accounts;

  PERFORM pg_temp.ok(v_total_before = v_total_after,
    'settlement conserves money: nothing minted, nothing destroyed');

  PERFORM pg_temp.ok(
    (SELECT available FROM public.usdc_accounts WHERE user_id = pg_temp.uid('alice')) = 3.8,
    'the winner receives exactly the loser''s stake');

  PERFORM pg_temp.ok(
    (SELECT escrow FROM public.usdc_accounts WHERE user_id = pg_temp.uid('bob')) = 0,
    'the loser''s escrow is drained');
END $$;

-- ------------------------------------------------------------
-- 6. Withdrawal round trip, including the revert path.
-- ------------------------------------------------------------

DO $$
DECLARE
  v_w public.usdc_withdrawals;
  v_avail_before NUMERIC;
BEGIN
  INSERT INTO public.wallet_links (user_id, address)
  VALUES (pg_temp.uid('alice'), '0x' || repeat('1', 40));

  SELECT available INTO v_avail_before FROM public.usdc_accounts WHERE user_id = pg_temp.uid('alice');

  v_w := public.begin_usdc_withdrawal(pg_temp.uid('alice'), 3.800000);

  PERFORM pg_temp.ok(
    (SELECT withdrawal_pending FROM public.usdc_accounts WHERE user_id = pg_temp.uid('alice')) = 3.8,
    'begin_usdc_withdrawal moves funds into withdrawal_pending');

  PERFORM pg_temp.ok(v_w.to_address = '0x' || repeat('1', 40),
    'the payout address is snapshotted from wallet_links, not supplied by the caller');

  -- A failed broadcast returns the money.
  PERFORM public.revert_usdc_withdrawal(v_w.id, 'simulated broadcast failure');

  PERFORM pg_temp.ok(
    (SELECT available FROM public.usdc_accounts WHERE user_id = pg_temp.uid('alice')) = v_avail_before,
    'reverting a withdrawal restores the exact prior available balance');

  PERFORM pg_temp.ok(
    (SELECT withdrawal_pending FROM public.usdc_accounts WHERE user_id = pg_temp.uid('alice')) = 0,
    'withdrawal_pending is drained by the revert');
END $$;

DO $$ BEGIN RAISE NOTICE '--- all assertions passed ---'; END $$;

ROLLBACK;


-- ============================================================
-- 7. TRUE CONCURRENT DOUBLE-SPEND. Two sessions, run by hand.
--
-- Sections 1-6 above run in one session, so they verify the CHECK constraints
-- and the sequential logic -- but not the thing that actually matters under
-- load: that two simultaneous spends of the same balance cannot both succeed.
-- That needs two real connections, because a single session can never contend
-- with itself for a row lock.
--
-- The scenario: Alice has exactly 100. Two bets of 100 each arrive at the
-- same instant. Exactly one must win.
--
-- Terminal A:
--   BEGIN;
--   SELECT public.move_usdc('escrow_lock', '<alice>', 'available',
--                           '<alice>', 'escrow', 100.000000);
--   -- do NOT commit yet; leave this transaction open
--
-- Terminal B (while A is still open):
--   BEGIN;
--   SELECT public.move_usdc('escrow_lock', '<alice>', 'available',
--                           '<alice>', 'escrow', 100.000000);
--   -- EXPECTED: this BLOCKS. It is waiting on the FOR UPDATE lock that A
--   -- holds on Alice's usdc_accounts row. If it returns immediately, the
--   -- lock is not doing its job and the design is broken.
--
-- Terminal A:
--   COMMIT;
--
-- Terminal B then unblocks and MUST fail with 'Insufficient available
-- balance'. It re-reads the balance under the lock it has now acquired and
-- sees 0, not the stale 100 it would have seen without the lock.
--
-- The failure this rules out: if the balance check happened outside the lock
-- (a SELECT in TypeScript, then an UPDATE), both sessions would read 100,
-- both would decide they had enough, and Alice would escrow 200 against a
-- balance of 100. The CHECK (available >= 0) would catch that particular
-- case -- but only because both spends were the full balance. Two spends of
-- 60 against 100 would both pass the CHECK and leave the account at -20 with
-- no constraint violated, which is why the lock, not the CHECK, is the real
-- protection.
--
-- Verify afterwards:
--   SELECT available, escrow FROM public.usdc_accounts WHERE user_id = '<alice>';
--   -- MUST be available = 0, escrow = 100. Never escrow = 200.
-- ============================================================
