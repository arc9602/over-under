BEGIN;

-- ============================================================
-- Finding people to add: by exact email, or by username prefix as you type.
--
-- Both are user-enumeration surfaces, and they are not equally sensitive, so
-- they get different rules.
--
-- Username is a public handle. profiles has had `FOR SELECT USING (true)`
-- since 002, so anyone signed in can already read every username; a typeahead
-- does not disclose anything new, it just makes it convenient. It is capped
-- and rate limited anyway, because "already possible" and "already easy" are
-- different things and there is no reason to hand out a scraper.
--
-- Email is not public, and on THIS app the question it answers is unusually
-- sensitive. A hit does not merely say "this address is registered" -- it says
-- "this person bets." That is something a coworker, a family member or an
-- employer could want to know and the user could very much not want disclosed.
-- So email lookup is exact-match only, never returns an address, honours an
-- opt-out, and is rate limited hard.
--
-- Exact-match-only is the load-bearing rule. Any partial match on email --
-- LIKE, prefix, domain -- turns "confirm an address you already know" into
-- "harvest the user list", and the second is a different feature wearing the
-- first one's clothes. There is no substring search here and there should
-- never be one.
-- ============================================================


-- ============================================================
-- 1. The opt-out
-- ============================================================
-- Defaults TRUE, matching what Venmo, Splitwise and Signal all do: a
-- discovery feature that nobody is in by default does not work, and the
-- searcher has to already know the address to get a hit. But it is a real
-- toggle, and section 3 honours it, because the alternative is deciding on
-- someone's behalf that being findable on a betting app is fine.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discoverable_by_email BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.profiles.discoverable_by_email IS
  'When false, find_profile_by_email will not return this user. Set from '
  'settings; nothing else may write it.';

-- Migration 017 revoked UPDATE on profiles down to three named columns, so a
-- new column is unwritable by the user client until it is granted here. That
-- is the constraint working as intended -- but it means adding a column and
-- forgetting this line produces a settings toggle that silently never saves.
GRANT UPDATE (discoverable_by_email) ON public.profiles TO authenticated;


-- ============================================================
-- 2. Prefix index for the typeahead
-- ============================================================
-- text_pattern_ops rather than the default opclass: a plain btree on text is
-- built for equality and range under the database's collation and will not
-- serve `LIKE 'foo%'`. This one will, and it is why the search below can be a
-- prefix match instead of a sequential scan over every profile on every
-- keystroke.
--
-- No lower() wrapper needed: username is constrained to ^[a-z0-9_]+$ (005),
-- so it is already lowercase and a plain LIKE is a case-correct comparison.
CREATE INDEX IF NOT EXISTS profiles_username_prefix_idx
  ON public.profiles (username text_pattern_ops);


-- ============================================================
-- 3. Lookup by exact email
-- ============================================================
-- Returns the profile columns the UI needs to render a person and NOTHING
-- else. Deliberately no email in the return type: the caller typed the
-- address they are searching for, so echoing it back tells them nothing,
-- while a shape that CAN carry an address is one refactor away from carrying
-- someone else's.
--
-- Reads auth.users, which is why this has to be SECURITY DEFINER -- no
-- application role can see that table, and it must stay that way.

CREATE OR REPLACE FUNCTION public.find_profile_by_email(
  p_user_id UUID,
  p_email TEXT
)
RETURNS TABLE (id UUID, username TEXT, display_name TEXT, avatar_url TEXT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email TEXT;
BEGIN
  -- Strict, and low: this is the enumeration budget. Someone working through
  -- a list of addresses gets ten answers a minute, which makes harvesting
  -- expensive without getting in the way of a person adding a friend.
  IF NOT public.check_rate_limit(p_user_id, 'friend_email_lookup', 10, 60) THEN
    RAISE EXCEPTION 'Too many lookups -- wait a moment and try again';
  END IF;

  v_email := lower(trim(p_email));

  -- Cheap shape check so obvious junk never reaches the index, and so a
  -- caller cannot probe with an empty string and match a NULL-ish row.
  IF v_email IS NULL OR v_email = '' OR position('@' IN v_email) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_url
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE
    -- Equality. Never LIKE. See this file's header.
    lower(u.email) = v_email
    -- An unconfirmed address proves nothing about who controls it. Without
    -- this, signing up with someone else's email makes you the search result
    -- for it.
    AND u.email_confirmed_at IS NOT NULL
    AND p.discoverable_by_email
    -- Finding yourself is never useful and the UI would offer to friend you.
    AND p.id <> p_user_id
  LIMIT 1;
END;
$$;


-- ============================================================
-- 4. Username prefix search
-- ============================================================
-- Prefix, not substring. `LIKE '%foo%'` cannot use the index above, and more
-- to the point it answers "who has 'foo' anywhere in their name", which is a
-- scraping primitive rather than a search box.

CREATE OR REPLACE FUNCTION public.search_profiles_by_username(
  p_user_id UUID,
  p_prefix TEXT
)
RETURNS TABLE (id UUID, username TEXT, display_name TEXT, avatar_url TEXT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prefix TEXT;
BEGIN
  -- Looser than the email budget -- this fires from a typeahead, and the data
  -- it returns is already world-readable under profiles' own SELECT policy --
  -- but still bounded. The client debounces too; this is the backstop for a
  -- caller that does not.
  IF NOT public.check_rate_limit(p_user_id, 'friend_username_search', 30, 60) THEN
    RAISE EXCEPTION 'Too many searches -- wait a moment and try again';
  END IF;

  v_prefix := lower(trim(p_prefix));
  IF v_prefix IS NULL OR length(v_prefix) < 2 THEN
    RETURN;
  END IF;

  -- Escaping is not optional here, and the reason is easy to miss: `_` is a
  -- legal username character (^[a-z0-9_]+$) AND a single-character LIKE
  -- wildcard. Unescaped, a search for "john_" also matches "johnny" -- so the
  -- typeahead would quietly surface people whose names the searcher never
  -- typed. `%` and `\` are escaped for the same reason, in that order,
  -- because escaping the escape character last would double-escape the others.
  v_prefix := replace(v_prefix, '\', '\\');
  v_prefix := replace(v_prefix, '%', '\%');
  v_prefix := replace(v_prefix, '_', '\_');

  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_url
  FROM public.profiles p
  WHERE p.username LIKE v_prefix || '%'
    AND p.id <> p_user_id
    -- Already friends: nothing to offer, so keep them out of a list whose
    -- every row is an "add" button.
    AND NOT EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE (f.user_low_id = LEAST(p.id, p_user_id)
         AND f.user_high_id = GREATEST(p.id, p_user_id))
    )
  ORDER BY p.username
  LIMIT 8;
END;
$$;


-- ============================================================
-- 5. Revoke
-- ============================================================
-- Both are reached only through the service client, from a server action that
-- has already established who the caller is. find_profile_by_email especially
-- must never be directly callable: it reads auth.users, and its whole
-- enumeration budget is the rate limit keyed to p_user_id -- a caller able to
-- invoke it with an arbitrary p_user_id could spread the cost across other
-- people's budgets and search without limit.
REVOKE ALL ON FUNCTION public.find_profile_by_email(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.search_profiles_by_username(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

COMMIT;


-- ============================================================
-- Verification. Run after COMMIT, not inside it.
-- ============================================================

-- 1. No email can leave these functions. Expect neither return type to
--    mention email.
-- SELECT p.proname, pg_get_function_result(p.oid) AS returns
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('find_profile_by_email', 'search_profiles_by_username');

-- 2. The wildcard escaping works. With a user named e.g. 'johnny' and none
--    named 'john_...', the first must return zero rows.
-- SELECT * FROM public.search_profiles_by_username('<your-uuid>', 'john_');
-- SELECT * FROM public.search_profiles_by_username('<your-uuid>', 'john');

-- 3. The prefix index is actually used rather than a seq scan over profiles.
-- EXPLAIN ANALYZE SELECT id FROM public.profiles WHERE username LIKE 'jo%';

-- 4. The opt-out is honoured end to end.
-- UPDATE public.profiles SET discoverable_by_email = FALSE WHERE id = '<uuid>';
-- SELECT * FROM public.find_profile_by_email('<other-uuid>', '<their-email>');
--   -- expect zero rows, then set it back to TRUE and expect one.
