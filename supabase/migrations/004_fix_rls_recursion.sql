-- Fix: "Participants can read bet_participants" caused infinite recursion (42P17)
-- because its own USING clause queried bet_participants again, re-triggering
-- the same policy. A SECURITY DEFINER helper bypasses RLS internally and
-- breaks the recursive evaluation.
--
-- Also fixes "Participants can read bets": the old subquery's unqualified
-- `id` resolved to bet_participants.id (shadowing) instead of bets.id,
-- silently breaking reads for non-creator participants.

CREATE OR REPLACE FUNCTION public.is_bet_participant(p_bet_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bet_participants
    WHERE bet_id = p_bet_id AND user_id = p_user_id
  );
$$;

DROP POLICY IF EXISTS "Participants can read bets" ON public.bets;
CREATE POLICY "Participants can read bets"
  ON public.bets FOR SELECT
  USING (
    auth.uid() = creator_id
    OR public.is_bet_participant(id, auth.uid())
  );

DROP POLICY IF EXISTS "Participants can read bet_participants" ON public.bet_participants;
CREATE POLICY "Participants can read bet_participants"
  ON public.bet_participants FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.is_bet_participant(bet_id, auth.uid())
  );
