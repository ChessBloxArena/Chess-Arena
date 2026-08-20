CREATE TABLE IF NOT EXISTS public.pvp_lobbies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.pvp_games(id) ON DELETE CASCADE,
  host_session_id text NOT NULL CHECK (length(btrim(host_session_id)) BETWEEN 1 AND 128),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 24),
  host_name text NOT NULL CHECK (length(btrim(host_name)) BETWEEN 1 AND 24),
  match_type text NOT NULL CHECK (match_type IN ('free', 'wager')),
  access text NOT NULL DEFAULT 'open' CHECK (access IN ('open', 'invite', 'holder')),
  preferred_color text NOT NULL DEFAULT 'random' CHECK (preferred_color IN ('random', 'white', 'black')),
  time_control text NOT NULL DEFAULT '5+0' CHECK (length(btrim(time_control)) BETWEEN 1 AND 16),
  stake_raw text CHECK (stake_raw IS NULL OR stake_raw ~ '^[0-9]+$'),
  stake_label text CHECK (stake_label IS NULL OR length(btrim(stake_label)) BETWEEN 1 AND 32),
  asset_symbol text CHECK (asset_symbol IS NULL OR length(btrim(asset_symbol)) BETWEEN 1 AND 16),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'cancelled', 'expired')),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '2 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id)
);

ALTER TABLE public.pvp_lobbies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pvp_lobbies FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pvp_lobbies TO service_role;

CREATE INDEX IF NOT EXISTS pvp_lobbies_directory_idx
ON public.pvp_lobbies (status ASC, expires_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS pvp_lobbies_game_status_idx
ON public.pvp_lobbies (game_id ASC, status ASC);

COMMENT ON TABLE public.pvp_lobbies IS
  'Server-authoritative lobby directory rows. Browser clients must use pvp-referee lobby actions to create, list, join, cancel, or heartbeat lobbies.';

COMMENT ON COLUMN public.pvp_lobbies.access IS
  'Directory visibility/access label. Holder-gated wager enforcement still happens in pvp-referee wager entry checks.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pvp_games_status_check'
      AND conrelid = 'public.pvp_games'::regclass
  ) THEN
    ALTER TABLE public.pvp_games
    DROP CONSTRAINT pvp_games_status_check;
  END IF;

  ALTER TABLE public.pvp_games
  ADD CONSTRAINT pvp_games_status_check
  CHECK (status IS NULL OR status IN ('waiting', 'active', 'finished', 'cancelled')) NOT VALID;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pvp_games_state_consistency_check'
      AND conrelid = 'public.pvp_games'::regclass
  ) THEN
    ALTER TABLE public.pvp_games
    DROP CONSTRAINT pvp_games_state_consistency_check;
  END IF;

  ALTER TABLE public.pvp_games
  ADD CONSTRAINT pvp_games_state_consistency_check
  CHECK (
    status IS NULL
    OR (
      status = 'waiting'
      AND black_session_id IS NULL
      AND winner IS NULL
    )
    OR (
      status = 'active'
      AND black_session_id IS NOT NULL
      AND winner IS NULL
    )
    OR (
      status = 'finished'
      AND black_session_id IS NOT NULL
      AND winner IN ('w', 'b', 'draw')
    )
    OR (
      status = 'cancelled'
      AND winner IS NULL
    )
  ) NOT VALID;
END $$;
