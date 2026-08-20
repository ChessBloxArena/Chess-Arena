ALTER TABLE public.pvp_games
ADD COLUMN IF NOT EXISTS refund_status text,
ADD COLUMN IF NOT EXISTS refund_error text,
ADD COLUMN IF NOT EXISTS refund_retryable_at timestamptz,
ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
ADD COLUMN IF NOT EXISTS refund_retry_count integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS settlement_attempted_at timestamptz,
ADD COLUMN IF NOT EXISTS settlement_retry_count integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS settlement_last_error text,
ADD COLUMN IF NOT EXISTS settlement_settled_at timestamptz,
ADD COLUMN IF NOT EXISTS accepted_move_count integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_accepted_move_at timestamptz,
ADD COLUMN IF NOT EXISTS finished_at timestamptz,
ADD COLUMN IF NOT EXISTS referee_result_hash text,
ADD COLUMN IF NOT EXISTS suspicious_flags text[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS suspicious_reason text,
ADD COLUMN IF NOT EXISTS escrow_onchain_state text,
ADD COLUMN IF NOT EXISTS escrow_checked_at timestamptz,
ADD COLUMN IF NOT EXISTS operator_notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pvp_games_refund_status_check'
      AND conrelid = 'public.pvp_games'::regclass
  ) THEN
    ALTER TABLE public.pvp_games
    ADD CONSTRAINT pvp_games_refund_status_check
    CHECK (
      refund_status IS NULL OR refund_status IN (
        'none',
        'pending',
        'refund_retryable',
        'refunded',
        'failed'
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pvp_games_referee_result_hash_check'
      AND conrelid = 'public.pvp_games'::regclass
  ) THEN
    ALTER TABLE public.pvp_games
    ADD CONSTRAINT pvp_games_referee_result_hash_check
    CHECK (referee_result_hash IS NULL OR length(referee_result_hash) = 64);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pvp_games_retry_counts_nonnegative_check'
      AND conrelid = 'public.pvp_games'::regclass
  ) THEN
    ALTER TABLE public.pvp_games
    ADD CONSTRAINT pvp_games_retry_counts_nonnegative_check
    CHECK (refund_retry_count >= 0 AND settlement_retry_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pvp_games_accepted_move_count_nonnegative_check'
      AND conrelid = 'public.pvp_games'::regclass
  ) THEN
    ALTER TABLE public.pvp_games
    ADD CONSTRAINT pvp_games_accepted_move_count_nonnegative_check
    CHECK (accepted_move_count >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS pvp_games_refund_retry_idx
ON public.pvp_games (refund_status ASC, refund_retryable_at ASC, updated_at ASC)
WHERE refund_status IN ('refund_retryable', 'failed');

CREATE INDEX IF NOT EXISTS pvp_games_settlement_worker_idx
ON public.pvp_games (settlement_status ASC, settlement_attempted_at ASC, updated_at ASC)
WHERE payment_status = 'both_deposited'
  AND settlement_status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS pvp_games_referee_result_idx
ON public.pvp_games (referee_result_hash ASC)
WHERE referee_result_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS pvp_games_suspicious_idx
ON public.pvp_games (updated_at DESC)
WHERE cardinality(suspicious_flags) > 0;

CREATE INDEX IF NOT EXISTS pvp_games_prize_eligibility_idx
ON public.pvp_games (settlement_settled_at DESC, finished_at DESC, updated_at DESC)
WHERE status = 'finished'
  AND payment_status = 'settled'
  AND settlement_status = 'settled'
  AND referee_result_hash IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS public.wager_prize_seasons (
  id text PRIMARY KEY,
  season_starts_at timestamptz NOT NULL,
  season_ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  result_hash text,
  result_payload jsonb,
  prize_pool_address text,
  total_prize_raw numeric(20, 0) NOT NULL DEFAULT 0,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wager_prize_seasons_window_check
    CHECK (season_ends_at > season_starts_at),
  CONSTRAINT wager_prize_seasons_status_check
    CHECK (status IN ('draft', 'published', 'paid', 'cancelled')),
  CONSTRAINT wager_prize_seasons_result_hash_check
    CHECK (result_hash IS NULL OR length(result_hash) = 64),
  CONSTRAINT wager_prize_seasons_total_prize_raw_check
    CHECK (total_prize_raw >= 0)
);

CREATE TABLE IF NOT EXISTS public.wager_prize_allocations (
  season_id text NOT NULL REFERENCES public.wager_prize_seasons(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  rank integer NOT NULL,
  wins integer NOT NULL,
  amount_raw numeric(20, 0) NOT NULL DEFAULT 0,
  tiebreaker text,
  claim_status text NOT NULL DEFAULT 'unclaimed',
  claim_signature text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, wallet_address),
  UNIQUE (season_id, rank),
  CONSTRAINT wager_prize_allocations_wallet_check
    CHECK (length(wallet_address) BETWEEN 32 AND 44),
  CONSTRAINT wager_prize_allocations_rank_check
    CHECK (rank BETWEEN 1 AND 10),
  CONSTRAINT wager_prize_allocations_wins_check
    CHECK (wins > 0),
  CONSTRAINT wager_prize_allocations_amount_raw_check
    CHECK (amount_raw >= 0),
  CONSTRAINT wager_prize_allocations_claim_status_check
    CHECK (claim_status IN ('unclaimed', 'claiming', 'claimed', 'failed'))
);

COMMENT ON TABLE public.wager_prize_seasons IS
  'Server-owned biweekly prize result records for verified wagered Chess Arena wins.';

COMMENT ON TABLE public.wager_prize_allocations IS
  'Server-owned top-10 prize allocations. Browser roles may read standings but cannot write claims or results.';

ALTER TABLE public.wager_prize_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wager_prize_allocations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.wager_prize_seasons REPLICA IDENTITY FULL;
ALTER TABLE public.wager_prize_allocations REPLICA IDENTITY FULL;

REVOKE ALL ON public.wager_prize_seasons FROM PUBLIC;
REVOKE ALL ON public.wager_prize_allocations FROM PUBLIC;
REVOKE ALL ON public.wager_prize_seasons FROM anon, authenticated;
REVOKE ALL ON public.wager_prize_allocations FROM anon, authenticated;

GRANT SELECT ON public.wager_prize_seasons TO anon, authenticated;
GRANT SELECT ON public.wager_prize_allocations TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wager_prize_seasons TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wager_prize_allocations TO service_role;

DROP POLICY IF EXISTS "Anyone can read prize seasons" ON public.wager_prize_seasons;
CREATE POLICY "Anyone can read prize seasons"
ON public.wager_prize_seasons
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Service role can manage prize seasons" ON public.wager_prize_seasons;
CREATE POLICY "Service role can manage prize seasons"
ON public.wager_prize_seasons
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can read prize allocations" ON public.wager_prize_allocations;
CREATE POLICY "Anyone can read prize allocations"
ON public.wager_prize_allocations
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Service role can manage prize allocations" ON public.wager_prize_allocations;
CREATE POLICY "Service role can manage prize allocations"
ON public.wager_prize_allocations
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS wager_prize_seasons_window_idx
ON public.wager_prize_seasons (season_starts_at DESC, season_ends_at DESC);

CREATE INDEX IF NOT EXISTS wager_prize_allocations_rank_idx
ON public.wager_prize_allocations (season_id ASC, rank ASC);

CREATE INDEX IF NOT EXISTS wager_prize_allocations_wallet_idx
ON public.wager_prize_allocations (wallet_address ASC, season_id DESC);
