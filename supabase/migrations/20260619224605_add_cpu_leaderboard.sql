CREATE TABLE IF NOT EXISTS public.cpu_match_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 8 AND 128),
  player_name text NOT NULL CHECK (
    length(btrim(player_name)) BETWEEN 1 AND 14
    AND player_name = upper(player_name)
    AND player_name ~ '^[A-Z0-9 _-]+$'
  ),
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  cpu_character text CHECK (cpu_character IS NULL OR cpu_character IN ('ivan', 'vinnie')),
  points integer NOT NULL CHECK (points IN (1, 3, 5)),
  moves text[] NOT NULL CHECK (
    cardinality(moves) BETWEEN 1 AND 300
    AND array_position(moves, NULL::text) IS NULL
  ),
  ply_count integer NOT NULL CHECK (ply_count BETWEEN 1 AND 300),
  result_hash text NOT NULL CHECK (length(result_hash) = 64),
  finished_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, request_id),
  UNIQUE (session_id, result_hash)
);

ALTER TABLE public.cpu_match_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cpu_match_results FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cpu_match_results TO service_role;

DROP POLICY IF EXISTS "Service role can manage CPU match results" ON public.cpu_match_results;
CREATE POLICY "Service role can manage CPU match results"
ON public.cpu_match_results
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS cpu_match_results_player_finished_idx
ON public.cpu_match_results (player_name ASC, finished_at DESC);

CREATE INDEX IF NOT EXISTS cpu_match_results_leaderboard_idx
ON public.cpu_match_results (points DESC, finished_at DESC);

CREATE OR REPLACE VIEW public.cpu_leaderboard
WITH (security_invoker = true)
AS
WITH grouped AS (
  SELECT
    player_name,
    sum(points)::integer AS score,
    count(*)::integer AS wins,
    count(*) FILTER (WHERE difficulty = 'easy')::integer AS easy_wins,
    count(*) FILTER (WHERE difficulty = 'medium')::integer AS medium_wins,
    count(*) FILTER (WHERE difficulty = 'hard')::integer AS hard_wins,
    max(finished_at) AS last_win_at
  FROM public.cpu_match_results
  GROUP BY player_name
)
SELECT
  row_number() OVER (
    ORDER BY score DESC, wins DESC, hard_wins DESC, last_win_at DESC, player_name ASC
  )::integer AS rank,
  player_name,
  score,
  wins,
  easy_wins,
  medium_wins,
  hard_wins,
  last_win_at
FROM grouped;

REVOKE ALL ON TABLE public.cpu_leaderboard FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cpu_leaderboard TO service_role;

COMMENT ON TABLE public.cpu_match_results IS
  'Server-validated local CPU checkmate wins submitted through pvp-referee. Browser clients must not write this table directly.';

COMMENT ON VIEW public.cpu_leaderboard IS
  'Aggregated People vs CPU leaderboard ordered by weighted score, wins, hard wins, recency, and player tag.';
