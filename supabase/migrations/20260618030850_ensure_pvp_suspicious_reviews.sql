CREATE TABLE IF NOT EXISTS public.pvp_suspicious_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.pvp_games(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  reviewer text,
  decision text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT pvp_suspicious_reviews_status_check
    CHECK (status IN ('open', 'excluded', 'cleared', 'needs_more_data')),
  CONSTRAINT pvp_suspicious_reviews_decision_audit_check
    CHECK (
      status NOT IN ('excluded', 'cleared')
      OR (
        reviewer IS NOT NULL
        AND length(trim(reviewer)) > 0
        AND decision IS NOT NULL
        AND length(trim(decision)) > 0
        AND reason IS NOT NULL
        AND length(trim(reason)) > 0
        AND reviewed_at IS NOT NULL
      )
    )
);

COMMENT ON TABLE public.pvp_suspicious_reviews IS
  'Operator-only audit trail for clearing or excluding suspicious PvP wager games from prize eligibility.';

COMMENT ON COLUMN public.pvp_suspicious_reviews.status IS
  'open and needs_more_data block prize eligibility; excluded permanently blocks; cleared resolves suspicious flags when reviewer, decision, reason, and reviewed_at are recorded.';

ALTER TABLE public.pvp_suspicious_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pvp_suspicious_reviews REPLICA IDENTITY FULL;

REVOKE ALL ON public.pvp_suspicious_reviews FROM PUBLIC;
REVOKE ALL ON public.pvp_suspicious_reviews FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pvp_suspicious_reviews TO service_role;

DROP POLICY IF EXISTS "Service role can manage suspicious reviews" ON public.pvp_suspicious_reviews;
CREATE POLICY "Service role can manage suspicious reviews"
ON public.pvp_suspicious_reviews
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS pvp_suspicious_reviews_game_idx
ON public.pvp_suspicious_reviews (game_id ASC, reviewed_at DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS pvp_suspicious_reviews_open_idx
ON public.pvp_suspicious_reviews (created_at ASC)
WHERE status IN ('open', 'needs_more_data');
