-- profiles: extends auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- bets
CREATE TABLE IF NOT EXISTS public.bets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code  TEXT UNIQUE NOT NULL DEFAULT substr(md5(random()::text), 1, 10),
  title        TEXT NOT NULL,
  description  TEXT,
  side_a_label TEXT NOT NULL DEFAULT 'Yes',
  side_b_label TEXT NOT NULL DEFAULT 'No',
  stake        NUMERIC(10,2) NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  deadline     TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','active','resolving','resolved','cancelled','expired','stuck')),
  creator_id   UUID NOT NULL REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

-- bet_participants
CREATE TABLE IF NOT EXISTS public.bet_participants (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id    UUID NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES public.profiles(id),
  side      TEXT NOT NULL CHECK (side IN ('a', 'b')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (bet_id, user_id),
  UNIQUE (bet_id, side)
);

-- resolutions
CREATE TABLE IF NOT EXISTS public.resolutions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id                UUID NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  proposed_by           UUID NOT NULL REFERENCES public.profiles(id),
  proposed_winner_side  TEXT NOT NULL CHECK (proposed_winner_side IN ('a', 'b')),
  confirmed_by          UUID REFERENCES public.profiles(id),
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','confirmed','disputed','superseded')),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ
);

-- iou_ledger (append-only)
CREATE TABLE IF NOT EXISTS public.iou_ledger (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id      UUID NOT NULL REFERENCES public.bets(id),
  creditor_id UUID NOT NULL REFERENCES public.profiles(id),
  debtor_id   UUID NOT NULL REFERENCES public.profiles(id),
  amount      NUMERIC(10,2) NOT NULL,
  settled     BOOLEAN NOT NULL DEFAULT FALSE,
  settled_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- settlements
CREATE TABLE IF NOT EXISTS public.settlements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL REFERENCES public.profiles(id),
  to_user_id   UUID NOT NULL REFERENCES public.profiles(id),
  amount       NUMERIC(10,2) NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- indexes
CREATE INDEX IF NOT EXISTS bets_creator_idx ON public.bets(creator_id);
CREATE INDEX IF NOT EXISTS bets_invite_code_idx ON public.bets(invite_code);
CREATE INDEX IF NOT EXISTS bet_participants_user_idx ON public.bet_participants(user_id);
CREATE INDEX IF NOT EXISTS resolutions_bet_idx ON public.resolutions(bet_id);
CREATE INDEX IF NOT EXISTS iou_ledger_creditor_idx ON public.iou_ledger(creditor_id);
CREATE INDEX IF NOT EXISTS iou_ledger_debtor_idx ON public.iou_ledger(debtor_id);
