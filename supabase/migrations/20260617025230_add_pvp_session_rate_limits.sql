CREATE TABLE IF NOT EXISTS public.pvp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_proof_hash text NOT NULL,
  ip_hash text,
  user_agent_hash text,
  wallet_address text,
  risk_score integer NOT NULL DEFAULT 0,
  action_counters jsonb NOT NULL DEFAULT '{}'::jsonb,
  captcha_verified_at timestamptz,
  wallet_verified_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  disabled_at timestamptz,
  disabled_reason text,
  CONSTRAINT pvp_sessions_risk_score_check CHECK (risk_score >= 0),
  CONSTRAINT pvp_sessions_wallet_address_check
    CHECK (wallet_address IS NULL OR length(wallet_address) BETWEEN 32 AND 44)
);

CREATE TABLE IF NOT EXISTS public.pvp_rate_limits (
  key text NOT NULL,
  action text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  PRIMARY KEY (key, action, window_start),
  CONSTRAINT pvp_rate_limits_count_check CHECK (count >= 0)
);

CREATE TABLE IF NOT EXISTS public.pvp_abuse_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid,
  game_id uuid,
  wallet_address text,
  ip_hash text,
  user_agent_hash text,
  action text NOT NULL,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pvp_abuse_events_severity_check
    CHECK (severity IN ('info', 'warning', 'critical'))
);

COMMENT ON TABLE public.pvp_sessions IS
  'Server-issued anonymous PvP sessions. Raw proofs are returned once to browsers and only SHA-256 proof hashes are stored.';

COMMENT ON TABLE public.pvp_rate_limits IS
  'Fixed-window PvP referee rate-limit counters keyed by hashed identifiers, session, wallet, action, and game where applicable.';

COMMENT ON TABLE public.pvp_abuse_events IS
  'Auditable PvP anti-abuse events such as invalid session proofs and rate-limit hits.';

ALTER TABLE public.pvp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pvp_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pvp_abuse_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pvp_sessions FROM PUBLIC;
REVOKE ALL ON public.pvp_rate_limits FROM PUBLIC;
REVOKE ALL ON public.pvp_abuse_events FROM PUBLIC;
REVOKE ALL ON public.pvp_sessions FROM anon, authenticated;
REVOKE ALL ON public.pvp_rate_limits FROM anon, authenticated;
REVOKE ALL ON public.pvp_abuse_events FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pvp_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pvp_rate_limits TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pvp_abuse_events TO service_role;

DROP POLICY IF EXISTS "Service role can manage PvP sessions" ON public.pvp_sessions;
CREATE POLICY "Service role can manage PvP sessions"
ON public.pvp_sessions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage PvP rate limits" ON public.pvp_rate_limits;
CREATE POLICY "Service role can manage PvP rate limits"
ON public.pvp_rate_limits
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage PvP abuse events" ON public.pvp_abuse_events;
CREATE POLICY "Service role can manage PvP abuse events"
ON public.pvp_abuse_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS pvp_sessions_expires_at_idx
ON public.pvp_sessions (expires_at ASC)
WHERE disabled_at IS NULL;

CREATE INDEX IF NOT EXISTS pvp_sessions_ip_first_seen_idx
ON public.pvp_sessions (ip_hash ASC, first_seen_at DESC)
WHERE ip_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS pvp_rate_limits_action_window_idx
ON public.pvp_rate_limits (action ASC, window_start DESC);

CREATE INDEX IF NOT EXISTS pvp_abuse_events_session_created_idx
ON public.pvp_abuse_events (session_id ASC, created_at DESC)
WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pvp_abuse_events_action_created_idx
ON public.pvp_abuse_events (action ASC, event_type ASC, created_at DESC);

CREATE OR REPLACE FUNCTION public.pvp_consume_rate_limit(
  p_key text,
  p_action text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer DEFAULT 0,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  allowed boolean,
  count integer,
  retry_after_seconds integer,
  window_start timestamptz,
  blocked_until timestamptz
)
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  WITH inputs AS (
    SELECT
      p_key AS key,
      p_action AS action,
      greatest(p_limit, 1) AS limit_value,
      greatest(p_window_seconds, 1) AS window_seconds,
      greatest(p_block_seconds, 0) AS block_seconds,
      p_now AS now_value,
      to_timestamp(
        floor(extract(epoch FROM p_now) / greatest(p_window_seconds, 1))
        * greatest(p_window_seconds, 1)
      ) AS window_value
  ),
  consumed AS (
    INSERT INTO public.pvp_rate_limits AS limits (
      key,
      action,
      window_start,
      count,
      blocked_until
    )
    SELECT
      inputs.key,
      inputs.action,
      inputs.window_value,
      1,
      NULL::timestamptz
    FROM inputs
    ON CONFLICT (key, action, window_start)
    DO UPDATE SET
      count = limits.count + 1,
      blocked_until = CASE
        WHEN limits.blocked_until IS NOT NULL
          AND limits.blocked_until > (SELECT now_value FROM inputs)
          THEN limits.blocked_until
        WHEN limits.count + 1 > (SELECT limit_value FROM inputs)
          AND (SELECT block_seconds FROM inputs) > 0
          THEN (SELECT now_value FROM inputs) + ((SELECT block_seconds FROM inputs) || ' seconds')::interval
        ELSE limits.blocked_until
      END
    RETURNING limits.count, limits.window_start, limits.blocked_until
  )
  SELECT
    consumed.count <= inputs.limit_value
      AND (consumed.blocked_until IS NULL OR consumed.blocked_until <= inputs.now_value) AS allowed,
    consumed.count,
    greatest(
      1,
      ceil(extract(epoch FROM (
        CASE
          WHEN consumed.blocked_until IS NOT NULL AND consumed.blocked_until > inputs.now_value
            THEN consumed.blocked_until
          ELSE consumed.window_start + (inputs.window_seconds || ' seconds')::interval
        END
        - inputs.now_value
      )))::integer
    ) AS retry_after_seconds,
    consumed.window_start,
    consumed.blocked_until
  FROM consumed
  CROSS JOIN inputs;
$$;

REVOKE ALL ON FUNCTION public.pvp_consume_rate_limit(text, text, integer, integer, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pvp_consume_rate_limit(text, text, integer, integer, integer, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_consume_rate_limit(text, text, integer, integer, integer, timestamptz) TO service_role;
