# Multi-option rollout

The application is hosted on Cloudflare Workers. Vercel is not part of this
release process.

Multi-option bets are guarded by `MULTI_OPTION_BETS_ENABLED`. The default is
off, so this branch can deploy before the database migration without changing
the current two-option experience or querying tables that do not exist yet.

## Release sequence

1. Have an authorized owner of Supabase project `gfdafravmyuwtdomespf` apply
   `supabase/migrations/008_bet_options.sql` as one transaction.
2. Run the verification queries below.
3. Deploy this branch with `MULTI_OPTION_BETS_ENABLED` unset.
4. Set `MULTI_OPTION_BETS_ENABLED=true` in the Cloudflare Worker runtime
   variables and deploy again.
5. Smoke-test an existing bet and a new three-option bet.

Do not deploy this branch or enable the flag before migration 008 commits
successfully. Applying the additive migration first keeps the currently
deployed two-option app working and closes the legacy RPC authorization gap.

## Migration verification

```sql
-- Every legacy bet should have exactly two backfilled options.
SELECT COUNT(*) AS bets_without_two_options
FROM public.bets b
WHERE (
  SELECT COUNT(*)
  FROM public.bet_options bo
  WHERE bo.bet_id = b.id
) <> 2;

-- Existing participants and resolutions must be mapped.
SELECT COUNT(*) AS participants_without_options
FROM public.bet_participants
WHERE option_id IS NULL;

SELECT COUNT(*) AS resolutions_without_options
FROM public.resolutions
WHERE proposed_winner_option_id IS NULL;

-- New RPCs should exist with only their intended grants.
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'create_bet_with_options',
    'place_option_wager',
    'propose_option_resolution',
    'propose_legacy_resolution',
    'confirm_option_resolution',
    'dispute_option_resolution'
  )
ORDER BY routine_name;
```

All three counts must be zero and all six RPC names must be returned.

## Smoke test

1. Confirm existing two-option bets and balances still load.
2. Create a bet with three uniquely named options.
3. Place wagers on two different options and confirm the bet becomes active.
4. Add to an existing wager and confirm cumulative min/max limits still apply.
5. Lock the bet, propose a funded winner, and confirm from another account.
6. Verify IOUs reflect all losing options.
7. Repeat with an unfunded winner and verify the UI says wagers were refunded
   and no IOUs were created.

## Emergency disable

Set `MULTI_OPTION_BETS_ENABLED=false` (or remove it) and redeploy Cloudflare.
This prevents new multi-option activity and restores the legacy two-option
queries. Multi-option data remains intact because migration 008 is additive.
Existing bets with more than two options may show only their first two options
while the flag is disabled.

Do not remove the legacy side columns or RPCs during this release. A later
contract migration can remove them after the feature has been stable.
