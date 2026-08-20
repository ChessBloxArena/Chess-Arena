ALTER TABLE public.pvp_games
ADD COLUMN IF NOT EXISTS finished_at timestamptz;

CREATE TABLE IF NOT EXISTS public.pvp_request_ids (
  session_id uuid NOT NULL,
  action text NOT NULL,
  request_id text NOT NULL,
  game_id uuid REFERENCES public.pvp_games(id) ON DELETE CASCADE,
  response_hash text,
  response_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, action, request_id),
  CONSTRAINT pvp_request_ids_action_check CHECK (length(action) BETWEEN 1 AND 64),
  CONSTRAINT pvp_request_ids_request_id_check CHECK (length(request_id) BETWEEN 8 AND 128),
  CONSTRAINT pvp_request_ids_response_hash_check CHECK (response_hash IS NULL OR length(response_hash) = 64)
);

CREATE INDEX IF NOT EXISTS pvp_request_ids_cleanup_idx
ON public.pvp_request_ids (created_at ASC);

CREATE INDEX IF NOT EXISTS pvp_request_ids_game_idx
ON public.pvp_request_ids (game_id ASC, created_at DESC)
WHERE game_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pvp_abuse_events_game_created_idx
ON public.pvp_abuse_events (game_id ASC, created_at DESC)
WHERE game_id IS NOT NULL;

ALTER TABLE public.pvp_request_ids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pvp_request_ids FROM PUBLIC;
REVOKE ALL ON public.pvp_request_ids FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pvp_request_ids TO service_role;

DROP POLICY IF EXISTS "Service role can manage PvP request ids" ON public.pvp_request_ids;
CREATE POLICY "Service role can manage PvP request ids"
ON public.pvp_request_ids
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
