BEGIN;

-- ============================================================
-- Deleting a bet that never really happened.
--
-- Until now a bet could only be cancelled (bets.status -> 'cancelled', via
-- 017's user-status-transition trigger), never actually removed. Two things
-- stood in the way of a real DELETE, both load-bearing and both left exactly
-- as they are by this migration:
--
--   1. iou_ledger.bet_id (001:55), ledger_transactions.bet_id (012:27), and
--      usdc_transactions.bet_id (014:140) all reference public.bets(id) with
--      no ON DELETE CASCADE. Postgres refuses a plain DELETE while any of
--      those rows exist -- that is the database's own refusal to destroy
--      financial history, and this migration does not add a cascade to any
--      of them to work around it.
--   2. public.bets has never had a FOR DELETE policy (see 002 onward), so
--      with RLS enabled a client DELETE is denied outright and affects zero
--      rows. This migration does not add one either -- the established
--      pattern for a mutation that decides something a policy can't express
--      (015:72-81, "REVOKE INSERT, UPDATE, DELETE ... GRANT SELECT") is a
--      SECURITY DEFINER function, and deletion is no exception to it.
--
-- The rule this function enforces, settled at the product level: delete
-- removes a bet that never really happened; cancel ends one that did. Once
-- someone besides the creator has taken a side, the bet is a record of an
-- agreement between people -- under the IOU model that record IS the
-- product -- so destroying it because the creator wants a tidier dashboard
-- is exactly what this function must refuse. It only ever deletes a bet
-- that:
--
--   - the caller created (creator_id = auth.uid());
--   - is not 'resolved' or 'resolving' -- a settled or settling bet is
--     already history, not a mistake to erase;
--   - has no bet_participants row besides the creator's own -- nobody else
--     has staked a side;
--   - has no iou_ledger, ledger_transactions, or usdc_transactions row
--     naming it, and no usdc_escrow_locks row naming it either -- checked
--     explicitly even though usdc_escrow_locks.bet_id (014:278) is the one
--     bet-referencing FK that DOES cascade. An escrow lock existing at all
--     would mean real money moved against this bet; that is a record this
--     function does not lean on a cascade to make disappear quietly. (In
--     practice no code path ever locks USDC escrow against a bet_id --
--     lib/money/placeOrder.ts only ever passes p_market_id to
--     lock_usdc_escrow -- but the schema still allows it, so the guard
--     checks it rather than assuming.)
--
-- Every one of those is checked while holding a row lock taken before any of
-- them, so a wager landing concurrently on this bet cannot slip in between
-- the checks and the DELETE: it either committed before this transaction
-- took the lock (in which case the participant/ledger checks above already
-- see it) or it blocks on the lock until this transaction finishes, after
-- which the bet is simply gone and its own INSERT fails on the FK instead.
--
-- What this makes unreachable: a bet vanishing out from under a participant,
-- a resolution, or a ledger/settlement/usdc row that names it.
-- bet_participants, resolutions, bet_options, bet_invites, and
-- usdc_escrow_locks all still cascade on DELETE (unchanged), but by the time
-- this function reaches its own DELETE statement, every one of those tables
-- is already known to hold nothing but the creator's own bet_participants
-- row, if even that -- the cascades are cleanup for rows this function has
-- already confirmed are empty or harmless, not a shortcut around checking
-- them.
-- ============================================================

CREATE FUNCTION public.delete_bet(p_bet_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_creator_id UUID;
  v_status TEXT;
  v_other_participants INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Lock the row before validating anything else -- see the block comment
  -- above for what this closes.
  SELECT creator_id, status
  INTO v_creator_id, v_status
  FROM public.bets
  WHERE id = p_bet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  IF v_creator_id <> v_user_id THEN
    RAISE EXCEPTION 'Only the creator can delete this bet';
  END IF;

  IF v_status IN ('resolved', 'resolving') THEN
    RAISE EXCEPTION 'A resolved or resolving bet cannot be deleted -- it is already a record of what happened';
  END IF;

  SELECT COUNT(*) INTO v_other_participants
  FROM public.bet_participants
  WHERE bet_id = p_bet_id AND user_id <> v_creator_id;

  IF v_other_participants > 0 THEN
    RAISE EXCEPTION 'This bet cannot be deleted -- someone else has already taken a side. Cancel it instead.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.iou_ledger WHERE bet_id = p_bet_id)
     OR EXISTS (SELECT 1 FROM public.ledger_transactions WHERE bet_id = p_bet_id)
     OR EXISTS (SELECT 1 FROM public.usdc_transactions WHERE bet_id = p_bet_id)
     OR EXISTS (SELECT 1 FROM public.usdc_escrow_locks WHERE bet_id = p_bet_id)
  THEN
    RAISE EXCEPTION 'This bet has financial records against it and cannot be deleted. Cancel it instead.';
  END IF;

  DELETE FROM public.bets WHERE id = p_bet_id;

  -- Redundant with the row lock above (nothing else could have deleted it
  -- out from under us), but matching 017's cancel_market_order convention of
  -- checking FOUND after the terminal statement rather than trusting the
  -- lock alone.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  RETURN p_bet_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_bet(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_bet(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
