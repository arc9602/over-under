BEGIN;

-- ============================================================
-- Closes a gap in 012: record_ledger_transaction is SECURITY DEFINER, and
-- Postgres grants EXECUTE on a new function to PUBLIC by default -- the
-- same default that made every financial RPC callable-as-anyone before
-- migration 011 fixed it. Supabase exposes public schema functions over
-- PostgREST, so as shipped in 012 any authenticated user could call
--
--   POST /rest/v1/rpc/record_ledger_transaction
--
-- directly and mint arbitrary balanced postings against other people's
-- ledger accounts.
--
-- This is separated from 012 rather than edited into it because 012 has
-- already been applied -- rewriting an applied migration leaves the file
-- describing something other than what the database actually ran.
--
-- Not fixed with 011's `<> auth.uid()` guard, because this function's two
-- account parameters are a settlement's creditor and debtor, who generally
-- are NOT the caller: the mirror_iou_to_ledger trigger runs as whoever
-- confirmed the resolution, and markSettled calls it through the
-- service-role client where auth.uid() is NULL. Reachability is the right
-- boundary here instead -- this function has no legitimate caller outside
-- the database.
--
-- Nothing legitimate loses access: mirror_iou_to_ledger is SECURITY DEFINER
-- and executes as the function owner, and markSettled uses the service
-- role. Neither depends on a grant to anon/authenticated.
--
-- Impact of the window before this runs: the ledger is still shadow
-- bookkeeping -- /balances and settle-up read iou_ledger, not
-- ledger_postings -- so a forged posting could not have moved real money,
-- only corrupted the ledger that is meant to become the source of truth.
-- Verification query for any postings written outside the two legitimate
-- paths is at the bottom of this file.
-- ============================================================

REVOKE ALL ON FUNCTION public.record_ledger_transaction(TEXT, UUID, UUID, UUID, UUID, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;

COMMIT;

-- ============================================================
-- Run after COMMIT, not inside the transaction above.
-- ============================================================

-- Confirms the grant is gone. Expect zero rows for anon/authenticated;
-- postgres/service_role may still appear and that is correct.
-- SELECT grantee, privilege_type
-- FROM information_schema.role_routine_grants
-- WHERE routine_name = 'record_ledger_transaction';

-- Every legitimate posting is either mirrored from an iou_ledger row
-- (bet_settlement / market_settlement) or a debt_payment written by
-- markSettled. Expect 0 rows; anything here was written by a direct call.
-- SELECT t.id, t.kind, t.created_at
-- FROM public.ledger_transactions t
-- WHERE t.kind IN ('bet_settlement', 'market_settlement')
--   AND NOT EXISTS (
--     SELECT 1 FROM public.iou_ledger i
--     WHERE i.bet_id IS NOT DISTINCT FROM t.bet_id
--       AND i.market_id IS NOT DISTINCT FROM t.market_id
--   );
