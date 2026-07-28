-- Fix: OAuth signups (Google, etc.) never populate raw_user_meta_data->>'username'
-- (only full_name/name/avatar_url/picture/email). The old fallback to the email
-- local-part isn't collision-safe against the UNIQUE constraint on username, and
-- any collision would hard-fail the entire auth.users insert. This generates a
-- guaranteed-unique username for OAuth signups and also populates avatar_url,
-- which was previously never set.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_raw_base  TEXT;
  v_base      TEXT;
  v_candidate TEXT;
  v_display   TEXT;
  v_avatar    TEXT;
  i           INT;
BEGIN
  v_raw_base := COALESCE(
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );
  v_base := left(regexp_replace(lower(v_raw_base), '[^a-z0-9_]', '', 'g'), 20);
  IF v_base IS NULL OR v_base = '' THEN
    v_base := 'user';
  END IF;

  v_candidate := v_base;

  IF NOT (NEW.raw_user_meta_data ? 'username') THEN
    FOR i IN 0..19 LOOP
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE username = v_candidate);
      v_candidate := v_base || '_' || floor(random() * 10000)::int::text;
    END LOOP;
  END IF;

  v_display := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  v_avatar := COALESCE(
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.raw_user_meta_data->>'picture'
  );

  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (NEW.id, v_candidate, v_display, v_avatar);

  RETURN NEW;
END;
$$;
