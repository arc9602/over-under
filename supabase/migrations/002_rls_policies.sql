-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iou_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Anyone can read profiles"
  ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- bets
-- Participants can read their bets; unauthenticated can read open bets by invite_code (handled app-side via service role)
CREATE POLICY "Participants can read bets"
  ON public.bets FOR SELECT
  USING (
    auth.uid() = creator_id
    OR auth.uid() IN (
      SELECT user_id FROM public.bet_participants WHERE bet_id = id
    )
  );

CREATE POLICY "Authenticated users can create bets"
  ON public.bets FOR INSERT WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Participants can update bets"
  ON public.bets FOR UPDATE
  USING (
    auth.uid() = creator_id
    OR auth.uid() IN (
      SELECT user_id FROM public.bet_participants WHERE bet_id = id
    )
  );

-- bet_participants
CREATE POLICY "Participants can read bet_participants"
  ON public.bet_participants FOR SELECT
  USING (
    auth.uid() = user_id
    OR auth.uid() IN (
      SELECT user_id FROM public.bet_participants bp2 WHERE bp2.bet_id = bet_id
    )
  );

CREATE POLICY "Users can insert their own participation"
  ON public.bet_participants FOR INSERT WITH CHECK (auth.uid() = user_id);

-- resolutions
CREATE POLICY "Participants can read resolutions"
  ON public.resolutions FOR SELECT
  USING (
    auth.uid() IN (
      SELECT user_id FROM public.bet_participants WHERE bet_id = resolutions.bet_id
    )
  );

CREATE POLICY "Participants can insert resolutions"
  ON public.resolutions FOR INSERT
  WITH CHECK (
    auth.uid() = proposed_by
    AND auth.uid() IN (
      SELECT user_id FROM public.bet_participants WHERE bet_id = resolutions.bet_id
    )
  );

CREATE POLICY "Participants can update resolutions"
  ON public.resolutions FOR UPDATE
  USING (
    auth.uid() IN (
      SELECT user_id FROM public.bet_participants WHERE bet_id = resolutions.bet_id
    )
  );

-- iou_ledger (service role only writes; participants can read)
CREATE POLICY "Participants can read their iou entries"
  ON public.iou_ledger FOR SELECT
  USING (auth.uid() = creditor_id OR auth.uid() = debtor_id);

-- settlements
CREATE POLICY "Users can read their settlements"
  ON public.settlements FOR SELECT
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

CREATE POLICY "Users can create settlements"
  ON public.settlements FOR INSERT WITH CHECK (auth.uid() = from_user_id);
