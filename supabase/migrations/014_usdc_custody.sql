BEGIN;

-- ============================================================
-- Custodial USDC balances, added ALONGSIDE iou_ledger rather than replacing
-- it -- the same additive discipline 012 used, and for the same reason: this
-- migration introduces real custodied money, and rewiring every existing
-- balance read path in that same change is how a live financial app's
-- numbers go quietly wrong with no fast way to tell.
--
-- What stays exactly as it is: bets, markets, iou_ledger, /balances,
-- settle-up, and every function in 010-013. A user who never deposits USDC
-- sees an app identical to the one before this migration.
--
-- The model. Every user has one usdc_accounts row holding three buckets:
--
--   available          -- spendable; can be escrowed or withdrawn
--   escrow             -- committed to a resting order or an open position
--   withdrawal_pending -- claimed by an in-flight on-chain withdrawal
--
-- Money only ever MOVES between buckets, and the chain itself is modelled as
-- a fourth bucket ('external') belonging to no user. That makes every single
-- financial event in this system -- deposit, escrow lock, settlement payout,
-- withdrawal, withdrawal reversal -- the same primitive: a two-sided
-- transfer that nets to zero. One function implements it; everything else
-- is a thin wrapper that picks the two endpoints.
--
-- Sign convention matches 012's ledger_postings: positive means the posting
-- increased that bucket, negative decreased it.
--
-- Units. NUMERIC(20,6), because USDC has 6 decimals on-chain. The 6 is not
-- decorative -- every amount here round-trips to an integer number of base
-- units, and lib/chain/amount.ts is the only place allowed to convert. No
-- float ever touches a balance, in SQL or in TypeScript.
-- ============================================================


-- ============================================================
-- 1. Wallet links
-- ============================================================
-- A user's verified on-chain address. Load-bearing in two directions:
--
--   deposits    -- a receipt proves SOME address sent USDC to the vault. It
--                  does not prove WHO. Matching the log's `from` against
--                  this table is what stops one user claiming another's
--                  deposit by racing them to /api/wallet/deposit with a
--                  hash scraped off the block explorer.
--   withdrawals -- the vault only ever pays out to the address recorded
--                  here, never to an address supplied in the request body.
--
-- Addresses are stored lowercased so the equality checks above can't be
-- defeated by EIP-55 checksum casing. The CHECK enforces that shape rather
-- than trusting the application to have called toLowerCase().

CREATE TABLE public.wallet_links (
  user_id     UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  address     TEXT NOT NULL UNIQUE CHECK (address ~ '^0x[0-9a-f]{40}$'),
  -- Which Privy wallet this is, for display. Not trusted for anything.
  wallet_type TEXT CHECK (wallet_type IN ('embedded', 'external')),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- UNIQUE on address is deliberate and stricter than it looks: it prevents
-- two accounts sharing one wallet, which would make deposit attribution
-- ambiguous the moment both of them claimed the same hash.


-- ============================================================
-- 2. Accounts
-- ============================================================
-- A materialized cache of the three bucket balances. It is a cache: the
-- ledger below is the source of truth, and the verification query at the
-- bottom of this file reconciles the two. It exists because every write path
-- needs to lock a single row and read a balance in the same breath, and
-- summing a growing ledger under FOR UPDATE on every bet placement is not a
-- thing that stays fast.
--
-- The CHECK (>= 0) constraints are the real backstop against overdraft. The
-- application checks balances too, and the functions below take row locks so
-- those checks can't race -- but if every one of those layers had a bug, the
-- database would still refuse to write a negative balance.

CREATE TABLE public.usdc_accounts (
  user_id            UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  available          NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (available >= 0),
  escrow             NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (escrow >= 0),
  withdrawal_pending NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (withdrawal_pending >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every profile gets an account, so no write path ever has to branch on
-- "does this user have one yet". Trigger for new profiles, backfill for
-- existing ones -- same belt-and-braces shape as 012's bet_options.
CREATE OR REPLACE FUNCTION public.create_usdc_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.usdc_accounts (user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_create_usdc_account
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_usdc_account();

INSERT INTO public.usdc_accounts (user_id)
SELECT id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;


-- ============================================================
-- 3. The ledger
-- ============================================================
-- Immutable double-entry, structurally identical to 012's
-- ledger_transactions/ledger_postings but with a bucket dimension, since
-- here the interesting movements are within one user as often as between
-- two (available -> escrow is one user's money changing state).
--
-- user_id is NULL for exactly one bucket, 'external', which represents the
-- chain. A deposit is (external -100, alice.available +100): balanced, and
-- it makes "how much should the vault hold on-chain?" answerable as a
-- single SUM over this table.

CREATE TABLE public.usdc_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN (
                'deposit',
                'escrow_lock',
                'escrow_release',
                'escrow_payout',
                'withdrawal_begin',
                'withdrawal_finalize',
                'withdrawal_revert'
              )),
  bet_id      UUID REFERENCES public.bets(id),
  market_id   UUID REFERENCES public.markets(id),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(bet_id, market_id) <= 1)
);

CREATE TABLE public.usdc_postings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.usdc_transactions(id),
  -- NULL only for the 'external' bucket; enforced by the CHECK below.
  user_id        UUID REFERENCES public.profiles(id),
  bucket         TEXT NOT NULL CHECK (bucket IN ('available', 'escrow', 'withdrawal_pending', 'external')),
  amount         NUMERIC(20,6) NOT NULL CHECK (amount <> 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT usdc_postings_external_has_no_user_chk
    CHECK ((bucket = 'external') = (user_id IS NULL))
);

CREATE INDEX usdc_postings_transaction_idx ON public.usdc_postings (transaction_id);
CREATE INDEX usdc_postings_user_idx ON public.usdc_postings (user_id, created_at);

-- Immutability via BEFORE UPDATE/DELETE triggers rather than RLS, for the
-- reason 012 spells out: a trigger fires regardless of role, so it holds
-- even against the service-role client the API routes use.
CREATE TRIGGER usdc_transactions_immutable
  BEFORE UPDATE OR DELETE ON public.usdc_transactions
  FOR EACH ROW EXECUTE FUNCTION public.reject_ledger_mutation();

CREATE TRIGGER usdc_postings_immutable
  BEFORE UPDATE OR DELETE ON public.usdc_postings
  FOR EACH ROW EXECUTE FUNCTION public.reject_ledger_mutation();

CREATE OR REPLACE FUNCTION public.check_usdc_transaction_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_sum NUMERIC;
BEGIN
  SELECT SUM(amount) INTO v_sum
  FROM public.usdc_postings
  WHERE transaction_id = NEW.transaction_id;

  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'USDC transaction % does not balance (postings sum to %)',
      NEW.transaction_id, v_sum;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER usdc_postings_balanced
  AFTER INSERT ON public.usdc_postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_usdc_transaction_balanced();


-- ============================================================
-- 4. Deposits
-- ============================================================
-- UNIQUE (transaction_hash) IS the replay defense. Not the application's
-- "SELECT ... then INSERT if absent" check, which is a textbook TOCTOU: two
-- concurrent POSTs with the same hash both read "not processed", both credit,
-- and the user has doubled their money. Here the second INSERT raises a
-- unique violation inside the same transaction that does the crediting, so
-- the credit rolls back with it. Concurrency is Postgres's problem, not the
-- route handler's.

CREATE TABLE public.usdc_deposits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.profiles(id),
  transaction_hash TEXT NOT NULL UNIQUE CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  from_address     TEXT NOT NULL CHECK (from_address ~ '^0x[0-9a-f]{40}$'),
  amount           NUMERIC(20,6) NOT NULL CHECK (amount > 0),
  block_number     BIGINT,
  transaction_id   UUID NOT NULL REFERENCES public.usdc_transactions(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX usdc_deposits_user_idx ON public.usdc_deposits (user_id, created_at);


-- ============================================================
-- 5. Withdrawals
-- ============================================================
-- Three-phase, because signing and broadcasting an on-chain transfer cannot
-- happen inside a database transaction:
--
--   begin    -- available -> withdrawal_pending, atomically. The money is
--               now unspendable, so the user cannot bet it while the
--               transfer is in flight.
--   finalize -- receipt confirmed: withdrawal_pending -> external.
--   revert   -- send failed or reverted: withdrawal_pending -> available.
--
-- to_address is snapshotted from wallet_links at begin time rather than
-- read at send time, so a wallet re-link mid-flight can't redirect an
-- already-authorized payout.

CREATE TABLE public.usdc_withdrawals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.profiles(id),
  to_address       TEXT NOT NULL CHECK (to_address ~ '^0x[0-9a-f]{40}$'),
  amount           NUMERIC(20,6) NOT NULL CHECK (amount > 0),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'sent', 'confirmed', 'failed')),
  transaction_hash TEXT CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  failure_reason   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX usdc_withdrawals_user_idx ON public.usdc_withdrawals (user_id, created_at);
CREATE UNIQUE INDEX usdc_withdrawals_hash_idx
  ON public.usdc_withdrawals (transaction_hash) WHERE transaction_hash IS NOT NULL;


-- ============================================================
-- 6. Escrow locks
-- ============================================================
-- What escrowed money is FOR. Without this, settlement knows a user has
-- $40 in escrow but not which market it belongs to, and a partial release
-- is unimplementable.
--
-- Locked at ORDER PLACEMENT, not at fill, and the amount is max loss:
--   YES @ p for q contracts -> p * q / 100
--   NO  @ p for q contracts -> (100 - p) * q / 100
-- Escrowing only on fill would let a user rest orders totalling far more
-- than their balance and go negative the moment several filled together --
-- the CHECK (available >= 0) would then start rejecting fills at random,
-- which is a much worse failure than refusing the order up front.

CREATE TABLE public.usdc_escrow_locks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id),
  market_id  UUID REFERENCES public.markets(id) ON DELETE CASCADE,
  order_id   UUID REFERENCES public.market_orders(id) ON DELETE CASCADE,
  bet_id     UUID REFERENCES public.bets(id) ON DELETE CASCADE,
  amount     NUMERIC(20,6) NOT NULL CHECK (amount > 0),
  -- released covers both outcomes: cancelled back to available, or paid out
  -- at settlement. usdc_transactions.kind distinguishes them.
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  CHECK (num_nonnulls(market_id, bet_id) = 1)
);

CREATE INDEX usdc_escrow_locks_user_idx ON public.usdc_escrow_locks (user_id, status);
CREATE INDEX usdc_escrow_locks_market_idx ON public.usdc_escrow_locks (market_id, status);
CREATE INDEX usdc_escrow_locks_order_idx ON public.usdc_escrow_locks (order_id);


-- ============================================================
-- 7. The one primitive every money movement goes through
-- ============================================================
-- Locks both endpoint accounts, verifies the source bucket covers the
-- amount, updates the cache, and writes the balanced pair of postings.
--
-- Lock ordering is the subtle part. Two accounts are locked per call, and a
-- settlement processes many payouts; if two concurrent transactions grabbed
-- (alice, bob) and (bob, alice) they would deadlock. Locking strictly in
-- ascending user_id order makes that impossible -- everyone queues for the
-- lowest-numbered account first, so there is no cycle to form.
--
-- NULL user_id ('external') is not lockable and is skipped: the chain has no
-- row to contend over.

CREATE OR REPLACE FUNCTION public.move_usdc(
  p_kind TEXT,
  p_from_user_id UUID,
  p_from_bucket TEXT,
  p_to_user_id UUID,
  p_to_bucket TEXT,
  p_amount NUMERIC,
  p_bet_id UUID DEFAULT NULL,
  p_market_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_transaction_id UUID;
  v_first  UUID;
  v_second UUID;
  v_balance NUMERIC;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'USDC amount must be positive';
  END IF;
  -- 6 decimals is the on-chain resolution; anything finer cannot be paid out
  -- and would silently accumulate as dust the vault can never settle.
  IF p_amount <> ROUND(p_amount, 6) THEN
    RAISE EXCEPTION 'USDC amount % has more than 6 decimal places', p_amount;
  END IF;
  IF p_from_user_id IS NOT DISTINCT FROM p_to_user_id AND p_from_bucket = p_to_bucket THEN
    RAISE EXCEPTION 'A USDC transfer needs two different endpoints';
  END IF;

  -- Deterministic lock order; see the header note on deadlocks. LEAST/GREATEST
  -- ignore NULLs, which is exactly the "skip external" behaviour wanted here.
  v_first  := LEAST(p_from_user_id, p_to_user_id);
  v_second := GREATEST(p_from_user_id, p_to_user_id);

  IF v_first IS NOT NULL THEN
    PERFORM 1 FROM public.usdc_accounts WHERE user_id = v_first FOR UPDATE;
  END IF;
  IF v_second IS NOT NULL AND v_second <> v_first THEN
    PERFORM 1 FROM public.usdc_accounts WHERE user_id = v_second FOR UPDATE;
  END IF;

  -- Debit the source. The balance check happens under the lock taken above,
  -- so a concurrent spend of the same funds waits here rather than reading a
  -- stale balance -- this is the double-spend guarantee.
  IF p_from_bucket <> 'external' THEN
    EXECUTE format(
      'UPDATE public.usdc_accounts SET %I = %I - $1, updated_at = NOW()
         WHERE user_id = $2 RETURNING %I', p_from_bucket, p_from_bucket, p_from_bucket)
    INTO v_balance USING p_amount, p_from_user_id;

    IF v_balance IS NULL THEN
      RAISE EXCEPTION 'No USDC account for user %', p_from_user_id;
    END IF;
    IF v_balance < 0 THEN
      RAISE EXCEPTION 'Insufficient % balance', p_from_bucket
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF p_to_bucket <> 'external' THEN
    EXECUTE format(
      'UPDATE public.usdc_accounts SET %I = %I + $1, updated_at = NOW()
         WHERE user_id = $2 RETURNING %I', p_to_bucket, p_to_bucket, p_to_bucket)
    INTO v_balance USING p_amount, p_to_user_id;

    IF v_balance IS NULL THEN
      RAISE EXCEPTION 'No USDC account for user %', p_to_user_id;
    END IF;
  END IF;

  INSERT INTO public.usdc_transactions (kind, bet_id, market_id, description)
  VALUES (p_kind, p_bet_id, p_market_id, p_description)
  RETURNING id INTO v_transaction_id;

  INSERT INTO public.usdc_postings (transaction_id, user_id, bucket, amount)
  VALUES
    (v_transaction_id, p_from_user_id, p_from_bucket, -p_amount),
    (v_transaction_id, p_to_user_id,   p_to_bucket,    p_amount);

  RETURN v_transaction_id;
END;
$$;

-- format(%I) on the bucket names is safe against injection -- %I quotes as an
-- identifier -- but the column must also actually exist, so the callers below
-- are the only things that supply bucket names, never a request body.


-- ============================================================
-- 8. Deposits
-- ============================================================
-- Called by /api/wallet/deposit ONLY after that route has verified the
-- receipt on-chain. This function deliberately does not and cannot verify
-- anything about the chain; it is the atomic bookkeeping half. The split
-- matters: the caller proves the money arrived, this proves it is recorded
-- exactly once.

CREATE OR REPLACE FUNCTION public.credit_usdc_deposit(
  p_user_id UUID,
  p_transaction_hash TEXT,
  p_from_address TEXT,
  p_amount NUMERIC,
  p_block_number BIGINT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_transaction_id UUID;
  v_deposit_id UUID;
BEGIN
  v_transaction_id := public.move_usdc(
    'deposit', NULL, 'external', p_user_id, 'available', p_amount,
    NULL, NULL, 'Deposit ' || p_transaction_hash
  );

  -- Raises unique_violation on a replayed hash, aborting the credit above
  -- along with it. Ordering is intentional: the insert that can fail comes
  -- last, so there is nothing to unwind by hand.
  INSERT INTO public.usdc_deposits (
    user_id, transaction_hash, from_address, amount, block_number, transaction_id
  ) VALUES (
    p_user_id, lower(p_transaction_hash), lower(p_from_address), p_amount,
    p_block_number, v_transaction_id
  )
  RETURNING id INTO v_deposit_id;

  RETURN v_deposit_id;
END;
$$;


-- ============================================================
-- 9. Escrow
-- ============================================================

CREATE OR REPLACE FUNCTION public.lock_usdc_escrow(
  p_user_id UUID,
  p_amount NUMERIC,
  p_market_id UUID DEFAULT NULL,
  p_order_id UUID DEFAULT NULL,
  p_bet_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_lock_id UUID;
BEGIN
  PERFORM public.move_usdc(
    'escrow_lock', p_user_id, 'available', p_user_id, 'escrow', p_amount,
    p_bet_id, p_market_id, NULL
  );

  INSERT INTO public.usdc_escrow_locks (user_id, market_id, order_id, bet_id, amount)
  VALUES (p_user_id, p_market_id, p_order_id, p_bet_id, p_amount)
  RETURNING id INTO v_lock_id;

  RETURN v_lock_id;
END;
$$;

-- Cancelled order / voided bet: the user gets their own stake back.
CREATE OR REPLACE FUNCTION public.release_usdc_escrow(p_lock_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_lock public.usdc_escrow_locks;
BEGIN
  SELECT * INTO v_lock FROM public.usdc_escrow_locks
  WHERE id = p_lock_id AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow lock % not found or already released', p_lock_id;
  END IF;

  PERFORM public.move_usdc(
    'escrow_release', v_lock.user_id, 'escrow', v_lock.user_id, 'available',
    v_lock.amount, v_lock.bet_id, v_lock.market_id, NULL
  );

  UPDATE public.usdc_escrow_locks
  SET status = 'released', released_at = NOW()
  WHERE id = p_lock_id;
END;
$$;

-- Settlement: escrowed money moves to whoever won it. from_user and to_user
-- differ here, which is why move_usdc bothers with ordered two-account
-- locking at all.
CREATE OR REPLACE FUNCTION public.payout_usdc_escrow(
  p_from_user_id UUID,
  p_to_user_id UUID,
  p_amount NUMERIC,
  p_market_id UUID DEFAULT NULL,
  p_bet_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN public.move_usdc(
    'escrow_payout', p_from_user_id, 'escrow', p_to_user_id, 'available',
    p_amount, p_bet_id, p_market_id, p_description
  );
END;
$$;


-- ============================================================
-- 10. Withdrawals
-- ============================================================

CREATE OR REPLACE FUNCTION public.begin_usdc_withdrawal(
  p_user_id UUID,
  p_amount NUMERIC
)
RETURNS public.usdc_withdrawals
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_address TEXT;
  v_row public.usdc_withdrawals;
BEGIN
  -- Destination comes from wallet_links, never from the request. Snapshotted
  -- into the row so a later re-link cannot redirect this payout.
  SELECT address INTO v_address FROM public.wallet_links WHERE user_id = p_user_id;
  IF v_address IS NULL THEN
    RAISE EXCEPTION 'No verified wallet linked to this account';
  END IF;

  -- One in-flight withdrawal at a time. Not a balance concern -- the buckets
  -- already handle that -- but it keeps the vault's nonce sequence serialized
  -- per user and makes the failure modes something a person can reason about.
  IF EXISTS (
    SELECT 1 FROM public.usdc_withdrawals
    WHERE user_id = p_user_id AND status IN ('pending', 'sent')
  ) THEN
    RAISE EXCEPTION 'You already have a withdrawal in progress';
  END IF;

  PERFORM public.move_usdc(
    'withdrawal_begin', p_user_id, 'available', p_user_id, 'withdrawal_pending',
    p_amount, NULL, NULL, NULL
  );

  INSERT INTO public.usdc_withdrawals (user_id, to_address, amount)
  VALUES (p_user_id, v_address, p_amount)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_usdc_withdrawal_sent(
  p_withdrawal_id UUID,
  p_transaction_hash TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.usdc_withdrawals
  SET status = 'sent', transaction_hash = lower(p_transaction_hash), updated_at = NOW()
  WHERE id = p_withdrawal_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal % not found or not pending', p_withdrawal_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_usdc_withdrawal(p_withdrawal_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row public.usdc_withdrawals;
BEGIN
  SELECT * INTO v_row FROM public.usdc_withdrawals
  WHERE id = p_withdrawal_id AND status IN ('pending', 'sent')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal % not found or already finalized', p_withdrawal_id;
  END IF;

  PERFORM public.move_usdc(
    'withdrawal_finalize', v_row.user_id, 'withdrawal_pending', NULL, 'external',
    v_row.amount, NULL, NULL, 'Withdrawal ' || COALESCE(v_row.transaction_hash, '')
  );

  UPDATE public.usdc_withdrawals
  SET status = 'confirmed', updated_at = NOW()
  WHERE id = p_withdrawal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_usdc_withdrawal(
  p_withdrawal_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row public.usdc_withdrawals;
BEGIN
  SELECT * INTO v_row FROM public.usdc_withdrawals
  WHERE id = p_withdrawal_id AND status IN ('pending', 'sent')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal % not found or already finalized', p_withdrawal_id;
  END IF;

  PERFORM public.move_usdc(
    'withdrawal_revert', v_row.user_id, 'withdrawal_pending', v_row.user_id, 'available',
    v_row.amount, NULL, NULL, p_reason
  );

  UPDATE public.usdc_withdrawals
  SET status = 'failed', failure_reason = p_reason, updated_at = NOW()
  WHERE id = p_withdrawal_id;
END;
$$;


-- ============================================================
-- 11. RLS
-- ============================================================
-- Read-only, own rows only. No INSERT/UPDATE/DELETE policies anywhere:
-- every write goes through the SECURITY DEFINER functions above, matching
-- the convention iou_ledger and ledger_postings already established.

ALTER TABLE public.wallet_links       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usdc_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usdc_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usdc_postings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usdc_deposits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usdc_withdrawals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usdc_escrow_locks  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own wallet link"
  ON public.wallet_links FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read their own USDC account"
  ON public.usdc_accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read their own USDC postings"
  ON public.usdc_postings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read their own deposits"
  ON public.usdc_deposits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read their own withdrawals"
  ON public.usdc_withdrawals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read their own escrow locks"
  ON public.usdc_escrow_locks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read USDC transactions they have a posting in"
  ON public.usdc_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.usdc_postings p
      WHERE p.transaction_id = usdc_transactions.id AND p.user_id = auth.uid()
    )
  );


-- ============================================================
-- 12. Revoke EXECUTE from anon/authenticated
-- ============================================================
-- Exactly the gap 013 closed on record_ledger_transaction, avoided here at
-- the point of creation instead of one migration later. Postgres grants
-- EXECUTE to PUBLIC by default and Supabase exposes public-schema functions
-- over PostgREST, so without this any logged-in user could
--
--   POST /rest/v1/rpc/credit_usdc_deposit
--
-- and credit themselves arbitrary USDC with no on-chain deposit behind it.
-- Unlike 012's shadow ledger, these balances ARE spendable and withdrawable,
-- so the same oversight here would be a direct drain of the vault.
--
-- 011's `<> auth.uid()` guard is not the right tool: every one of these is
-- called from a route handler through the service-role client, where
-- auth.uid() is NULL. Reachability is the boundary. Nothing legitimate loses
-- access -- service_role is not affected by a revoke from anon/authenticated.

REVOKE ALL ON FUNCTION public.move_usdc(TEXT, UUID, TEXT, UUID, TEXT, NUMERIC, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_usdc_deposit(UUID, TEXT, TEXT, NUMERIC, BIGINT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_usdc_escrow(UUID, NUMERIC, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_usdc_escrow(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_usdc_escrow(UUID, UUID, NUMERIC, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_usdc_withdrawal(UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_usdc_withdrawal_sent(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_usdc_withdrawal(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revert_usdc_withdrawal(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

COMMIT;


-- ============================================================
-- Reconciliation queries. Run after COMMIT, not inside it.
-- ============================================================

-- 1. The cache matches the ledger. Expect zero rows. If this ever returns
--    anything, usdc_accounts has drifted from usdc_postings and the ledger
--    is the one to believe.
-- SELECT a.user_id, a.available, l.available AS ledger_available,
--        a.escrow, l.escrow AS ledger_escrow,
--        a.withdrawal_pending, l.withdrawal_pending AS ledger_withdrawal_pending
-- FROM public.usdc_accounts a
-- JOIN LATERAL (
--   SELECT COALESCE(SUM(amount) FILTER (WHERE bucket = 'available'), 0) AS available,
--          COALESCE(SUM(amount) FILTER (WHERE bucket = 'escrow'), 0) AS escrow,
--          COALESCE(SUM(amount) FILTER (WHERE bucket = 'withdrawal_pending'), 0) AS withdrawal_pending
--   FROM public.usdc_postings WHERE user_id = a.user_id
-- ) l ON TRUE
-- WHERE (a.available, a.escrow, a.withdrawal_pending)
--    IS DISTINCT FROM (l.available, l.escrow, l.withdrawal_pending);

-- 2. Solvency: what the vault must hold on-chain. Every user balance in
--    every bucket is a claim against the vault, and this is their total.
--    Compare against balanceOf(VAULT_ADDRESS). The vault should hold at
--    least this much; more is fine (gas top-ups), less means insolvent.
-- SELECT SUM(available + escrow + withdrawal_pending) AS total_user_claims
-- FROM public.usdc_accounts;

-- 3. Equivalently, from the ledger alone -- the negated external bucket is
--    net USDC that has flowed in and not yet flowed out. Should equal (2).
-- SELECT -COALESCE(SUM(amount), 0) AS net_deposited
-- FROM public.usdc_postings WHERE bucket = 'external';

-- 4. Escrow locks reconcile against the escrow bucket. Expect zero rows.
-- SELECT a.user_id, a.escrow, COALESCE(SUM(e.amount), 0) AS open_locks
-- FROM public.usdc_accounts a
-- LEFT JOIN public.usdc_escrow_locks e ON e.user_id = a.user_id AND e.status = 'open'
-- GROUP BY a.user_id, a.escrow
-- HAVING a.escrow <> COALESCE(SUM(e.amount), 0);
