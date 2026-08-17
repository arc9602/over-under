BEGIN;

-- ============================================================
-- Live updates, and the indexes the hot paths were missing.
--
-- The design in one line: the database broadcasts "something on market X
-- changed" to a private channel, and the client refetches through the same
-- RLS-protected queries it already uses. No row data ever crosses the
-- socket.
--
-- Why not postgres_changes, which is the obvious way to do this. Two
-- reasons, and they point the same direction:
--
--   Security. postgres_changes streams the actual changed row to every
--   subscriber, and Supabase filters it per subscriber using RLS. That works
--   until one policy is wrong, and then the failure mode is other people's
--   bets and IOUs arriving in a browser -- the highest-consequence leak this
--   schema has. Worse, DELETE events carry only the primary key unless the
--   table is set to REPLICA IDENTITY FULL, and setting that publishes entire
--   old rows to the replication stream. Broadcasting a signal instead makes
--   the leak structurally impossible: there is nothing in the payload to
--   leak. A channel-authorization bug costs an attacker the knowledge that a
--   market changed, which they can already see by opening it.
--
--   Cost. postgres_changes evaluates RLS per row, per subscriber. The market
--   policies call can_access_market(), which is two EXISTS subqueries. One
--   fill on a market with 500 watchers is 500 policy evaluations, inside the
--   database, synchronously. Broadcast authorizes once when a client joins
--   the channel, and fan-out afterwards costs nothing in Postgres.
--
-- Nothing is added to the supabase_realtime publication. Broadcast does not
-- use logical replication at all, so table rows are never streamed off the
-- database in the first place.
-- ============================================================


-- ============================================================
-- 1. Topic parsing
-- ============================================================
-- Channels are named 'market:<uuid>' and 'bet:<uuid>'. The policies below
-- have to turn that string back into an id to check access, and the string
-- is supplied by whoever is trying to subscribe -- so it is untrusted input
-- being fed to a UUID cast inside a security policy.
--
-- A bare substring(...)::UUID raises on anything malformed, and an exception
-- thrown from inside an RLS policy is an error to the client, not a denial.
-- This returns NULL instead, which every caller below treats as "no access"
-- because can_access_market(NULL, ...) and is_bet_participant(NULL, ...)
-- are both false. Malformed topic, no access, no error.
CREATE OR REPLACE FUNCTION public.topic_uuid(p_topic TEXT, p_prefix TEXT)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_topic IS NOT NULL
     AND p_topic LIKE p_prefix || '%'
     AND substring(p_topic FROM length(p_prefix) + 1)
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN substring(p_topic FROM length(p_prefix) + 1)::UUID
    ELSE NULL
  END;
$$;


-- ============================================================
-- 2. Channel authorization
-- ============================================================
-- A private broadcast channel is joinable only if the subscriber passes a
-- SELECT policy on realtime.messages. This is the entire access control for
-- live updates, and it reuses the exact predicates that already gate reading
-- the underlying rows -- can_access_market (008) and is_bet_participant
-- (004). A user who cannot read a market cannot watch it change.
--
-- Scoped to `authenticated`: anonymous visitors on the public invite pages
-- get no live channel. They can still read the invite landing through its
-- own server-rendered path; they just do not get a socket.

-- No `ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY` here, and its
-- absence is deliberate rather than an omission. That table belongs to
-- supabase_realtime_admin, not to the role the SQL editor runs as, so the
-- statement fails with "42501: must be owner of table messages" -- and it
-- would be a no-op anyway, because Supabase ships realtime.messages with RLS
-- already enabled. The policies below are the whole of the access control;
-- there is no switch left un-flipped underneath them.
DROP POLICY IF EXISTS "Traders may join their market channels" ON realtime.messages;
CREATE POLICY "Traders may join their market channels"
  ON realtime.messages FOR SELECT
  TO authenticated
  USING (
    extension = 'broadcast'
    AND public.can_access_market(
          public.topic_uuid(realtime.topic(), 'market:'),
          auth.uid()
        )
  );

DROP POLICY IF EXISTS "Participants may join their bet channels" ON realtime.messages;
CREATE POLICY "Participants may join their bet channels"
  ON realtime.messages FOR SELECT
  TO authenticated
  USING (
    extension = 'broadcast'
    AND public.is_bet_participant(
          public.topic_uuid(realtime.topic(), 'bet:'),
          auth.uid()
        )
  );

-- Deliberately no INSERT policy. Clients may listen and may not speak: every
-- message on these channels originates from a trigger below, running as the
-- database. Without this, any authorized subscriber could broadcast a forged
-- "market changed" to everyone else watching -- harmless on its own, since
-- the payload carries no data and the client refetches under RLS, but it is
-- free to withhold and a client-writable channel invites someone to start
-- trusting its contents later.


-- ============================================================
-- 3. The signal
-- ============================================================
-- Payload carries no user data on purpose -- not the actor, not an amount,
-- not a row. The id is already in the topic name, and only clients that
-- passed section 2 are receiving it. `kind` exists so a client can refetch
-- narrowly instead of reloading everything.
--
-- realtime.send() is called with private := true so delivery goes through
-- the policies above rather than to anyone who guesses the topic string.

-- Reads the transition table, NOT NEW/OLD. A FOR EACH STATEMENT trigger has
-- no current row -- NEW and OLD simply do not exist in one, and touching them
-- is a runtime error rather than a compile-time one, so it would have failed
-- on the first order placed. `REFERENCING NEW TABLE AS changed` is how a
-- statement-level trigger sees what the statement actually wrote.
--
-- DISTINCT because one statement can touch several rows on the same market
-- (the matcher fills against multiple resting orders at once) and that is one
-- change to anyone watching. It can also legitimately span two markets, which
-- is why this loops rather than assuming a single id.
CREATE OR REPLACE FUNCTION public.notify_market_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_market_id UUID;
BEGIN
  FOR v_market_id IN
    SELECT DISTINCT market_id FROM changed WHERE market_id IS NOT NULL
  LOOP
    PERFORM realtime.send(
      jsonb_build_object('kind', TG_ARGV[0], 'at', NOW()),
      'changed',
      'market:' || v_market_id::TEXT,
      true
    );
  END LOOP;
  RETURN NULL;
END;
$$;

-- markets itself has no market_id column -- its own id is the topic.
CREATE OR REPLACE FUNCTION public.notify_market_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('kind', 'market', 'at', NOW()),
    'changed',
    'market:' || NEW.id::TEXT,
    true
  );
  RETURN NULL;
END;
$$;

-- Same transition-table reasoning as notify_market_change above.
CREATE OR REPLACE FUNCTION public.notify_bet_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_bet_id UUID;
BEGIN
  FOR v_bet_id IN
    SELECT DISTINCT bet_id FROM changed WHERE bet_id IS NOT NULL
  LOOP
    PERFORM realtime.send(
      jsonb_build_object('kind', TG_ARGV[0], 'at', NOW()),
      'changed',
      'bet:' || v_bet_id::TEXT,
      true
    );
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_bet_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('kind', 'bet', 'at', NOW()),
    'changed',
    'bet:' || NEW.id::TEXT,
    true
  );
  RETURN NULL;
END;
$$;

-- AFTER STATEMENT, not AFTER ROW. place_market_order can write many fills in
-- one call and the matcher updates several orders in the same statement; a
-- per-row trigger would emit a broadcast for each, and every watcher would
-- refetch the same book that many times. One statement is one change as far
-- as a viewer is concerned.
-- Split per event rather than `AFTER INSERT OR UPDATE`, because Postgres
-- refuses a transition table on a trigger registered for more than one event.
-- The alias is `changed` in every one of them -- the functions above look it
-- up by that name, so a trigger that renames it compiles fine here and fails
-- at runtime.

CREATE TRIGGER market_orders_notify_insert
  AFTER INSERT ON public.market_orders
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_market_change('orders');

CREATE TRIGGER market_orders_notify_update
  AFTER UPDATE ON public.market_orders
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_market_change('orders');

CREATE TRIGGER market_fills_notify_insert
  AFTER INSERT ON public.market_fills
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_market_change('fills');

CREATE TRIGGER market_resolutions_notify_insert
  AFTER INSERT ON public.market_resolutions
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_market_change('resolution');

CREATE TRIGGER market_resolutions_notify_update
  AFTER UPDATE ON public.market_resolutions
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_market_change('resolution');

CREATE TRIGGER bet_participants_notify_insert
  AFTER INSERT ON public.bet_participants
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_bet_change('wagers');

CREATE TRIGGER bet_participants_notify_update
  AFTER UPDATE ON public.bet_participants
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_bet_change('wagers');

CREATE TRIGGER resolutions_notify_insert
  AFTER INSERT ON public.resolutions
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_bet_change('resolution');

CREATE TRIGGER resolutions_notify_update
  AFTER UPDATE ON public.resolutions
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_bet_change('resolution');

-- These two are per-row because the topic comes from the changed row's own
-- id, which a statement-level trigger cannot see. Status and price changes
-- are rare compared to order flow, so the extra sends are not a concern.
CREATE TRIGGER markets_notify
  AFTER UPDATE ON public.markets
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.last_price IS DISTINCT FROM NEW.last_price
  )
  EXECUTE FUNCTION public.notify_market_row_change();

CREATE TRIGGER bets_notify
  AFTER UPDATE ON public.bets
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_bet_row_change();

-- The notify_* functions are trigger-only; nothing should be able to call
-- them directly to forge a broadcast.
REVOKE ALL ON FUNCTION public.notify_market_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_market_row_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_bet_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_bet_row_change() FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 4. Indexes the hot paths were missing
-- ============================================================
-- Every one of these backs a filter that already exists in the application;
-- none of them anticipates a query nobody writes.

-- `.eq("settled", false)` is the single hottest filter in the app -- every
-- balance read and the whole debt-simplification path start with it -- and
-- there was no index on `settled` at all. Partial rather than plain: settled
-- rows are the ones that accumulate forever, and none of them are ever
-- selected by this predicate, so keeping them out of the index keeps it
-- roughly the size of the outstanding debt rather than of all history.
CREATE INDEX IF NOT EXISTS iou_ledger_open_creditor_idx
  ON public.iou_ledger (creditor_id) WHERE settled = FALSE;
CREATE INDEX IF NOT EXISTS iou_ledger_open_debtor_idx
  ON public.iou_ledger (debtor_id) WHERE settled = FALSE;

-- simplify_debt_cycles walks outstanding rows for one exact pair, oldest
-- first. This is that access path exactly, including the sort.
CREATE INDEX IF NOT EXISTS iou_ledger_open_pair_idx
  ON public.iou_ledger (debtor_id, creditor_id, created_at)
  WHERE settled = FALSE;

-- /admin/metrics buckets these by week and now filters to the last twelve.
CREATE INDEX IF NOT EXISTS bet_participants_joined_idx
  ON public.bet_participants (joined_at);
CREATE INDEX IF NOT EXISTS profiles_created_idx
  ON public.profiles (created_at);

COMMIT;


-- ============================================================
-- Verification. Run after COMMIT, not inside it.
-- ============================================================

-- 1. Broadcast authorization is on and scoped. Expect exactly the two SELECT
--    policies above, and NO insert policy.
-- SELECT policyname, cmd, roles FROM pg_policies
-- WHERE schemaname = 'realtime' AND tablename = 'messages';

-- 1b. RLS really is enabled on that table. The migration asserts this rather
--     than setting it (see section 2), so it is worth confirming once --
--     policies on a table with RLS off are silently inert, which would leave
--     these channels open to any authenticated user. Expect relrowsecurity = t.
-- SELECT relname, relrowsecurity FROM pg_class
-- WHERE oid = 'realtime.messages'::regclass;

-- 2. A malformed topic denies rather than errors. Expect NULL, not an
--    exception -- this is the untrusted-input path in section 1.
-- SELECT public.topic_uuid('market:../../etc/passwd', 'market:') AS should_be_null,
--        public.topic_uuid('market:not-a-uuid', 'market:')       AS also_null,
--        public.topic_uuid('bet:' || gen_random_uuid()::text, 'bet:') AS a_real_uuid;

-- 3. No table was added to the replication publication -- broadcast must not
--    quietly become row streaming. Expect zero rows for this app's tables.
-- SELECT schemaname, tablename FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime' AND schemaname = 'public';

-- 4. The triggers fire and address the right topic. Place one order, then
--    look for a broadcast row on 'market:<that id>'. A statement trigger that
--    silently did nothing is the failure mode worth checking for here --
--    nothing else in the app notices.
-- SELECT topic, event, payload, inserted_at FROM realtime.messages
-- ORDER BY inserted_at DESC LIMIT 10;

-- 5. The new indexes are actually being chosen. Expect an Index Scan using
--    iou_ledger_open_pair_idx, not a Seq Scan.
-- EXPLAIN ANALYZE
-- SELECT id, amount FROM public.iou_ledger
-- WHERE debtor_id = '00000000-0000-0000-0000-000000000000'
--   AND creditor_id = '00000000-0000-0000-0000-000000000001'
--   AND settled = FALSE
-- ORDER BY created_at ASC;
