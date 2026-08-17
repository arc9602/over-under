BEGIN;

-- ============================================================
-- Cancel closed loops of debt, so fewer payments have to happen.
--
-- If A owes B $10, B owes C $10 and C owes A $10, nobody needs to pay
-- anybody. Three payments become zero and every person's net position is
-- exactly what it was. Generalized: find a cycle in the debt graph, subtract
-- the smallest debt on it from every edge in it, repeat until acyclic. The
-- graph search lives in lib/utils/simplifyDebts.ts, where it is unit-tested
-- against a conservation property; this function is what applies the result
-- atomically and refuses it if the arithmetic does not hold up.
--
-- Why cycles only, and not full debt minimization. Minimizing the number of
-- payments outright (greedily matching the largest creditor to the largest
-- debtor) produces fewer transactions, but it invents creditor-debtor pairs
-- that never existed -- you settle up with a stranger the algorithm chose,
-- because they happened to balance the graph. Cycle cancellation can only
-- ever SHRINK a debt that two people already have. Nobody is ever routed to
-- someone they have not already bet with.
--
-- Two properties follow from that, and both are load-bearing below:
--
--   1. It is net-zero for every single participant. Cancelling m around
--      A -> B -> C -> A gives A (+m, -m), B (+m, -m), C (+m, -m). This is why
--      it is safe to let any user trigger it: nobody's worth moves, so there
--      is no position to take. It is also why NOTHING may be posted to the
--      double-entry ledger -- see section 3.
--
--   2. Provenance survives. Because only existing pairs shrink, a partially
--      cancelled row splits into a remainder row for the SAME pair, which
--      inherits the parent's bet_id/market_id. iou_ledger_source_chk
--      (migration 008: every IOU traces to exactly one bet or market) needs
--      no relaxing, and every dollar still points at the event that created
--      it. Full minimization would have forced that constraint open.
-- ============================================================


-- ============================================================
-- 1. Audit trail
-- ============================================================
-- One row per run. Without it, a user whose debt to a friend silently
-- halved has no way to find out why, and support has nothing to reconstruct
-- from -- the iou_ledger rows involved would just be `settled` with no
-- payment behind them, which is indistinguishable from a bug.

CREATE TABLE public.debt_simplifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiated_by     UUID NOT NULL REFERENCES public.profiles(id),
  -- One per creditor-debtor pair whose debt shrank, NOT one per loop: the
  -- function receives the already-flattened reductions, and a single loop of
  -- three people reduces three pairs. Named for what is actually counted.
  pairs_reduced    INT NOT NULL DEFAULT 0,
  cents_cancelled  BIGINT NOT NULL DEFAULT 0 CHECK (cents_cancelled >= 0),
  rows_settled     INT NOT NULL DEFAULT 0,
  rows_split       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX debt_simplifications_user_idx
  ON public.debt_simplifications (initiated_by, created_at);

-- Marks both sides of the operation: the rows a simplification settled, and
-- the remainder rows it created. Nullable because every row written before
-- this migration, and every row from a real bet settlement after it, has no
-- simplification behind it.
ALTER TABLE public.iou_ledger
  ADD COLUMN IF NOT EXISTS simplification_id UUID REFERENCES public.debt_simplifications(id);

CREATE INDEX iou_ledger_simplification_idx
  ON public.iou_ledger (simplification_id) WHERE simplification_id IS NOT NULL;

COMMENT ON COLUMN public.iou_ledger.simplification_id IS
  'Set on rows cancelled by simplify_debt_cycles, and on the remainder rows '
  'it creates. A settled row with this set was cancelled against a loop, not paid.';


-- ============================================================
-- 2. RLS
-- ============================================================
-- Readable by the people it affected, so the UI can explain a changed
-- balance. No write policy: the only writer is the SECURITY DEFINER function
-- in section 4, matching iou_ledger's own convention.

ALTER TABLE public.debt_simplifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read simplifications that touched their debts"
  ON public.debt_simplifications FOR SELECT
  USING (
    auth.uid() = initiated_by
    OR EXISTS (
      SELECT 1 FROM public.iou_ledger l
      WHERE l.simplification_id = debt_simplifications.id
        AND (l.creditor_id = auth.uid() OR l.debtor_id = auth.uid())
    )
  );


-- ============================================================
-- 3. The double-entry ledger must NOT move
-- ============================================================
-- mirror_iou_to_ledger (012) posts every iou_ledger INSERT into
-- ledger_postings, so the double-entry ledger can never go stale behind a
-- new code path. That is exactly right for a settlement, and exactly wrong
-- here.
--
-- A remainder row is not new debt. It is the surviving fraction of a debt
-- already posted when its parent row was inserted. Posting it again would
-- add its amount to both parties a second time, and ledger_balances -- which
-- a later migration is meant to make the source of truth for /balances --
-- would drift by the full cancelled amount on every run, in a table whose
-- immutability triggers make it unfixable without a migration.
--
-- The cancellation itself needs no posting either, for the reason in this
-- file's header: it is net-zero for every participant, so the correct
-- double-entry representation of a cycle cancellation is no entry at all.
--
-- Skipping rather than reversing keeps that true without writing a pair of
-- cancelling postings that would have to be filtered back out of every
-- history view.
CREATE OR REPLACE FUNCTION public.mirror_iou_to_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.simplification_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.record_ledger_transaction(
    CASE WHEN NEW.bet_id IS NOT NULL THEN 'bet_settlement' ELSE 'market_settlement' END,
    NEW.bet_id,
    NEW.market_id,
    NEW.creditor_id,
    NEW.debtor_id,
    NEW.amount
  );
  RETURN NEW;
END;
$$;


-- ============================================================
-- 4. Apply a simplification
-- ============================================================
-- Takes the reductions computed by lib/utils/simplifyDebts.ts as
--   [{"debtor": uuid, "creditor": uuid, "cents": int}, ...]
-- and applies each one by retiring outstanding rows for that exact pair.
--
-- The plan arrives from the application, so it is treated as a request, not
-- as truth. Two things make that safe:
--
--   * Every reduction names a pair, and this function only ever REDUCES
--     debt for the pair named. There is no code path here that creates a
--     debt between two users who did not already have one, whatever the
--     input says. The worst a malicious plan can do is cancel debt that
--     should have stood -- which the net-position check below then catches,
--     because cancelling a non-cycle changes somebody's net.
--
--   * Net positions are snapshotted before and recomputed after, and any
--     drift at all aborts the whole transaction. That check is the real
--     guarantee. It does not trust the graph algorithm, this function's own
--     row-walking, or the caller; it just asserts the one property that
--     must hold, and rolls back if it does not.
--
-- Any authenticated user may run this. That is a deliberate consequence of
-- cycle-only cancellation: it moves nobody's net worth and gives nobody a
-- new counterparty, so there is no position for a caller to take and nothing
-- to gain by running it against someone else's loop. Rate-limited anyway, so
-- it cannot be used to churn the ledger.

CREATE OR REPLACE FUNCTION public.simplify_debt_cycles(
  p_user_id UUID,
  p_reductions JSONB
)
RETURNS public.debt_simplifications
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_before JSONB;
  v_after JSONB;
  v_drift TEXT;
  v_users UUID[];
  v_simplification public.debt_simplifications;
  v_reduction JSONB;
  v_debtor UUID;
  v_creditor UUID;
  v_remaining NUMERIC;
  v_row RECORD;
  v_take NUMERIC;
  v_pairs INT := 0;
  v_cents BIGINT := 0;
  v_settled INT := 0;
  v_split INT := 0;
BEGIN
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acting user must match the authenticated session';
  END IF;

  IF p_reductions IS NULL OR jsonb_typeof(p_reductions) <> 'array' THEN
    RAISE EXCEPTION 'Reductions must be a JSON array';
  END IF;

  IF jsonb_array_length(p_reductions) = 0 THEN
    RAISE EXCEPTION 'Nothing to simplify';
  END IF;

  IF NOT public.check_rate_limit(p_user_id, 'simplify_debts', 5, 60) THEN
    RAISE EXCEPTION 'Too many simplification attempts -- wait a moment and try again';
  END IF;

  -- Everyone this plan touches, from both ends of every reduction.
  SELECT ARRAY(
    SELECT (r ->> 'debtor')::UUID FROM jsonb_array_elements(p_reductions) r
    UNION
    SELECT (r ->> 'creditor')::UUID FROM jsonb_array_elements(p_reductions) r
  ) INTO v_users;

  -- Lock this plan's rows before reading balances, so a settlement landing
  -- mid-run cannot make the after-snapshot disagree with the before-snapshot
  -- for a reason that has nothing to do with this function.
  --
  -- Scoped to the users in the plan, not the whole table. Locking every
  -- unsettled row (the obvious way to write this) makes one simplification
  -- serialize against every settle-up, wager payout and resolution in the
  -- application at once -- correct, and a hard ceiling on concurrency that
  -- arrives long before the row count does. The set below is bounded by the
  -- size of the loop, which is small.
  --
  -- Locking by USER rather than by pair is deliberate and is what makes the
  -- narrower net-position check below sound: a user in this plan may also
  -- hold debt on a pair the plan never names, and that row has to be frozen
  -- too or their net could move underneath us for an unrelated reason and
  -- abort a perfectly good simplification.
  --
  -- ORDER BY id gives every concurrent caller the same lock order, so two
  -- overlapping simplifications queue instead of deadlocking -- the same
  -- discipline move_usdc uses for its two-account locking in 014.
  PERFORM 1 FROM public.iou_ledger
  WHERE settled = FALSE
    AND (debtor_id = ANY(v_users) OR creditor_id = ANY(v_users))
  ORDER BY id
  FOR UPDATE;

  v_before := public.net_iou_positions(v_users);

  -- Created before the rows that reference it: every row this function
  -- touches is stamped with this id, so the audit row has to exist first.
  -- The counters are filled in at the end, once they are known.
  INSERT INTO public.debt_simplifications (initiated_by)
  VALUES (p_user_id)
  RETURNING * INTO v_simplification;

  FOR v_reduction IN SELECT * FROM jsonb_array_elements(p_reductions)
  LOOP
    v_debtor   := (v_reduction ->> 'debtor')::UUID;
    v_creditor := (v_reduction ->> 'creditor')::UUID;
    -- Cents in, dollars out. The application works in integer cents
    -- precisely so no float ever reaches this column; converting here, once,
    -- is what keeps that true across the boundary.
    v_remaining := (v_reduction ->> 'cents')::BIGINT::NUMERIC / 100;

    IF v_debtor IS NULL OR v_creditor IS NULL THEN
      RAISE EXCEPTION 'Every reduction needs a debtor and a creditor';
    END IF;
    IF v_debtor = v_creditor THEN
      RAISE EXCEPTION 'A reduction cannot name the same user twice';
    END IF;
    IF v_remaining IS NULL OR v_remaining <= 0 THEN
      RAISE EXCEPTION 'Reduction amounts must be positive';
    END IF;

    v_pairs := v_pairs + 1;

    -- Oldest first, so the debt that has stood longest is the one that
    -- clears -- the same ordering markSettled uses when it applies a payment
    -- across several IOUs.
    FOR v_row IN
      SELECT id, amount, bet_id, market_id
      FROM public.iou_ledger
      WHERE debtor_id = v_debtor AND creditor_id = v_creditor AND settled = FALSE
      ORDER BY created_at ASC, id ASC
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_take := LEAST(v_row.amount, v_remaining);

      IF v_take >= v_row.amount THEN
        -- Row cancelled outright.
        UPDATE public.iou_ledger
        SET settled = TRUE, settled_at = NOW(), simplification_id = v_simplification.id
        WHERE id = v_row.id;
        v_settled := v_settled + 1;
      ELSE
        -- Partially cancelled: retire the original and carry the balance
        -- forward as a new row for the same pair, inheriting the parent's
        -- source so iou_ledger_source_chk still holds and the remaining debt
        -- still names the bet it came from. simplification_id on the new row
        -- is also what keeps mirror_iou_to_ledger from double-posting it.
        UPDATE public.iou_ledger
        SET settled = TRUE, settled_at = NOW(), simplification_id = v_simplification.id
        WHERE id = v_row.id;

        INSERT INTO public.iou_ledger
          (bet_id, market_id, creditor_id, debtor_id, amount, simplification_id)
        VALUES
          (v_row.bet_id, v_row.market_id, v_creditor, v_debtor,
           v_row.amount - v_take, v_simplification.id);

        v_split := v_split + 1;
      END IF;

      v_remaining := v_remaining - v_take;
    END LOOP;

    -- The plan asked to cancel more than this pair actually owes. That means
    -- the graph the plan was computed from no longer matches the database,
    -- so the whole plan is stale and none of it should be trusted.
    IF v_remaining > 0 THEN
      RAISE EXCEPTION
        'Debt from % to % changed while simplifying -- please try again', v_debtor, v_creditor;
    END IF;

    v_cents := v_cents + (v_reduction ->> 'cents')::BIGINT;
  END LOOP;

  -- ------------------------------------------------------------------
  -- The check everything rests on.
  -- ------------------------------------------------------------------
  -- Cancelling loops must leave every user's net position bit-for-bit
  -- identical. If any of it drifted, something that was not a cycle was
  -- cancelled -- somebody just lost or gained real money -- and the only
  -- correct response is to undo all of it.
  -- Same user set as the before-snapshot. Anyone outside it is unreachable
  -- from this plan: every row written above belongs to a pair drawn from
  -- v_users, so a third party's net cannot have moved because of us.
  v_after := public.net_iou_positions(v_users);

  WITH before_positions AS (
    SELECT key AS user_id, value::NUMERIC AS net FROM jsonb_each_text(v_before)
  ),
  after_positions AS (
    SELECT key AS user_id, value::NUMERIC AS net FROM jsonb_each_text(v_after)
  )
  SELECT string_agg(COALESCE(b.user_id, a.user_id), ', ')
  INTO v_drift
  FROM before_positions b
  FULL OUTER JOIN after_positions a ON b.user_id = a.user_id
  WHERE COALESCE(b.net, 0) IS DISTINCT FROM COALESCE(a.net, 0);

  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to simplify: net position changed for %. No debt was altered.', v_drift;
  END IF;

  UPDATE public.debt_simplifications
  SET pairs_reduced = v_pairs,
      cents_cancelled  = v_cents,
      rows_settled     = v_settled,
      rows_split       = v_split
  WHERE id = v_simplification.id
  RETURNING * INTO v_simplification;

  RETURN v_simplification;
END;
$$;


-- ============================================================
-- 5. Net position helper
-- ============================================================
-- Outstanding position for the named users as a {user_id: net} JSON object,
-- where positive means owed money overall. Split out because it is called
-- twice inside one transaction and the two calls have to compute the number
-- the same way by construction, not by two edits staying in step.
--
-- Takes an explicit user set rather than scanning the whole ledger. Two
-- reasons, and the second is the load-bearing one:
--
--   * It runs inside simplify_debt_cycles' transaction, which holds locks.
--     Aggregating every unsettled row in the application there would make
--     the cost of one simplification grow with total app size rather than
--     with the size of the loop being cancelled.
--   * Only the locked users are stable. Anyone outside the plan can have
--     their net legitimately change mid-transaction from unrelated activity,
--     and including them would abort valid simplifications at random -- more
--     often as the app gets busier, which is exactly backwards.
CREATE OR REPLACE FUNCTION public.net_iou_positions(p_users UUID[])
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER STABLE SET search_path = ''
AS $$
  -- Key cast is required, not cosmetic: jsonb_object_agg takes a text key,
  -- and a UUID key is a runtime "function does not exist" error, not a
  -- compile-time one -- it would surface on the first real call.
  SELECT COALESCE(jsonb_object_agg(user_id::TEXT, net), '{}'::JSONB)
  FROM (
    SELECT user_id, SUM(delta) AS net
    FROM (
      SELECT creditor_id AS user_id,  amount AS delta
        FROM public.iou_ledger
        WHERE settled = FALSE AND creditor_id = ANY(p_users)
      UNION ALL
      SELECT debtor_id   AS user_id, -amount AS delta
        FROM public.iou_ledger
        WHERE settled = FALSE AND debtor_id = ANY(p_users)
    ) entries
    GROUP BY user_id
  ) totals;
$$;


-- ============================================================
-- 6. Revoke
-- ============================================================
-- Same reachability boundary as every money function since 014: reached only
-- through the service client, from a server action that has already
-- established who the caller is. net_iou_positions is revoked too -- it
-- aggregates across every user in the system, and RLS does not apply inside
-- a SECURITY DEFINER function, so leaving it callable would publish the
-- entire debt graph's shape to any signed-in user.
REVOKE ALL ON FUNCTION public.simplify_debt_cycles(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.net_iou_positions(UUID[])
  FROM PUBLIC, anon, authenticated;

COMMIT;


-- ============================================================
-- Verification. Run after COMMIT, not inside it.
-- ============================================================

-- 1. No debt was created between a pair that did not already have one.
--    Every simplification remainder row must have an older sibling for the
--    same pair. Expect zero rows.
-- SELECT r.id, r.debtor_id, r.creditor_id
-- FROM public.iou_ledger r
-- WHERE r.simplification_id IS NOT NULL AND r.settled = FALSE
--   AND NOT EXISTS (
--     SELECT 1 FROM public.iou_ledger o
--     WHERE o.debtor_id = r.debtor_id AND o.creditor_id = r.creditor_id
--       AND o.id <> r.id AND o.created_at <= r.created_at
--   );

-- 2. The double-entry ledger did not move. ledger_balances must still equal
--    the position computed from iou_ledger history (settled or not), since a
--    simplification posts nothing. Expect zero rows.
-- SELECT b.user_id, b.balance
-- FROM public.ledger_balances b
-- JOIN LATERAL (
--   SELECT COALESCE(SUM(CASE WHEN l.creditor_id = b.user_id THEN l.amount ELSE -l.amount END), 0) AS iou_net
--   FROM public.iou_ledger l
--   WHERE (l.creditor_id = b.user_id OR l.debtor_id = b.user_id)
--     AND l.simplification_id IS NULL
-- ) i ON TRUE
-- WHERE b.balance IS DISTINCT FROM i.iou_net;

-- 3. What each run actually saved.
-- SELECT id, initiated_by, pairs_reduced, cents_cancelled / 100.0 AS dollars,
--        rows_settled, rows_split, created_at
-- FROM public.debt_simplifications ORDER BY created_at DESC;
