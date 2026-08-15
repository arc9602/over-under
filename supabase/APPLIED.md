# Applied migrations

Migrations in this project are applied **by hand**, through the Supabase SQL editor. This file is
the record of which ones have been run against production.

It exists because CI deploys code but does not apply SQL. Without it, pushing a commit whose code
calls a function that was never created puts a broken path live and nothing complains until a user
finds it. `scripts/check-migrations.mjs` runs in CI and fails the build when a migration file has no
entry here, so forgetting becomes loud instead of silent.

## What this is and is not

This is an **affirmation**, not proof. Ticking a line here says "I ran this"; it cannot verify the
SQL actually executed. It catches the realistic failure: writing a migration, shipping the code that
needs it, and forgetting the SQL entirely. It does not catch a migration that was run badly or only
halfway.

If you are unsure whether something was applied, check the database before ticking it. For an RPC,
calling it through PostgREST with the anon key distinguishes the two cases cleanly. A missing
function returns `404 PGRST202` ("Could not find the function"), while one that exists but is
correctly revoked returns `401` with SQLSTATE `42501` ("permission denied for function"). Permission
denied means it is there.

## How to add a migration

1. Write `supabase/migrations/0NN_name.sql`.
2. Run it in the Supabase SQL editor against production.
3. Add its filename to the list below, in order.
4. Commit all three together. CI will fail the deploy if step 3 is missing.

Do not tick a line before running the SQL. The whole value of the file is that it is honest.

## Applied

- 001_initial_schema.sql
- 002_rls_policies.sql
- 003_functions_triggers.sql
- 004_fix_rls_recursion.sql
- 005_google_oauth_username.sql
- 006_pooled_bets.sql
- 007_cumulative_wager_limits.sql
- 008_prediction_markets.sql
- 009_bet_options.sql
- 010_resolution_authorization_fix.sql
- 011_caller_identity_and_rate_limiting.sql
- 012_ledger_and_multi_option_bets.sql
- 013_revoke_ledger_writer_grant.sql
- 014_usdc_custody.sql
- 015_friends_and_bet_invites.sql
- 016_market_backing.sql
- 017_direct_write_hardening.sql
- 018_delete_bet.sql
