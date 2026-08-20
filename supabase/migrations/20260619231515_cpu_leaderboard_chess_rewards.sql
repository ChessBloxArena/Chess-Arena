ALTER TABLE public.cpu_match_results
DROP CONSTRAINT IF EXISTS cpu_match_results_points_check;

UPDATE public.cpu_match_results
SET points = CASE difficulty
  WHEN 'easy' THEN 5000
  WHEN 'medium' THEN 10000
  WHEN 'hard' THEN 15000
  ELSE points
END
WHERE points IS DISTINCT FROM CASE difficulty
  WHEN 'easy' THEN 5000
  WHEN 'medium' THEN 10000
  WHEN 'hard' THEN 15000
  ELSE points
END;

ALTER TABLE public.cpu_match_results
ADD CONSTRAINT cpu_match_results_points_check
CHECK (points IN (5000, 10000, 15000));

ALTER TABLE public.cpu_match_results
ADD COLUMN IF NOT EXISTS payout_wallet_address text,
ADD COLUMN IF NOT EXISTS payout_payer_address text,
ADD COLUMN IF NOT EXISTS payout_token_mint text NOT NULL DEFAULT 'Dp4pqN6R2WprUakMDdqjEdebFbNrdWRPJAeexpvYpump',
ADD COLUMN IF NOT EXISTS payout_token_program_id text NOT NULL DEFAULT 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
ADD COLUMN IF NOT EXISTS payout_amount_raw bigint NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'not_applicable',
ADD COLUMN IF NOT EXISTS payout_signature text,
ADD COLUMN IF NOT EXISTS payout_error text,
ADD COLUMN IF NOT EXISTS payout_retry_count integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS payout_attempted_at timestamptz,
ADD COLUMN IF NOT EXISTS payout_submitted_at timestamptz,
ADD COLUMN IF NOT EXISTS payout_paid_at timestamptz;

UPDATE public.cpu_match_results
SET payout_amount_raw = CASE
  WHEN payout_wallet_address IS NULL THEN 0
  ELSE points::bigint * 1000000
END,
payout_status = CASE
  WHEN payout_wallet_address IS NULL THEN 'not_applicable'
  WHEN payout_signature IS NOT NULL THEN 'submitted'
  ELSE 'pending'
END
WHERE payout_amount_raw = 0
  OR payout_status = 'not_applicable';

ALTER TABLE public.cpu_match_results
DROP CONSTRAINT IF EXISTS cpu_match_results_payout_wallet_address_check;

ALTER TABLE public.cpu_match_results
ADD CONSTRAINT cpu_match_results_payout_wallet_address_check
CHECK (
  payout_wallet_address IS NULL
  OR payout_wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
);

ALTER TABLE public.cpu_match_results
DROP CONSTRAINT IF EXISTS cpu_match_results_payout_payer_address_check;

ALTER TABLE public.cpu_match_results
ADD CONSTRAINT cpu_match_results_payout_payer_address_check
CHECK (
  payout_payer_address IS NULL
  OR payout_payer_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
);

ALTER TABLE public.cpu_match_results
DROP CONSTRAINT IF EXISTS cpu_match_results_payout_token_mint_check;

ALTER TABLE public.cpu_match_results
ADD CONSTRAINT cpu_match_results_payout_token_mint_check
CHECK (payout_token_mint = 'Dp4pqN6R2WprUakMDdqjEdebFbNrdWRPJAeexpvYpump');

ALTER TABLE public.cpu_match_results
DROP CONSTRAINT IF EXISTS cpu_match_results_payout_token_program_id_check;

ALTER TABLE public.cpu_match_results
ADD CONSTRAINT cpu_match_results_payout_token_program_id_check
CHECK (payout_token_program_id = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

ALTER TABLE public.cpu_match_results
DROP CONSTRAINT IF EXISTS cpu_match_results_payout_amount_raw_check;

ALTER TABLE public.cpu_match_results
ADD CONSTRAINT cpu_match_results_payout_amount_raw_check
CHECK (
  payout_amount_raw = CASE
    WHEN payout_wallet_address IS NULL THEN 0
    ELSE points::bigint * 1000000
  END
);

ALTER TABLE public.cpu_match_results
DROP CONSTRAINT IF EXISTS cpu_match_results_payout_status_check;

ALTER TABLE public.cpu_match_results
ADD CONSTRAINT cpu_match_results_payout_status_check
CHECK (payout_status IN ('not_applicable', 'pending', 'processing', 'submitted', 'paid', 'failed'));

ALTER TABLE public.cpu_match_results
DROP CONSTRAINT IF EXISTS cpu_match_results_payout_signature_check;

ALTER TABLE public.cpu_match_results
ADD CONSTRAINT cpu_match_results_payout_signature_check
CHECK (
  payout_signature IS NULL
  OR payout_signature ~ '^[1-9A-HJ-NP-Za-km-z]{16,128}$'
);

ALTER TABLE public.cpu_match_results
DROP CONSTRAINT IF EXISTS cpu_match_results_payout_consistency_check;

ALTER TABLE public.cpu_match_results
ADD CONSTRAINT cpu_match_results_payout_consistency_check
CHECK (
  (
    payout_wallet_address IS NULL
    AND payout_amount_raw = 0
    AND payout_status = 'not_applicable'
    AND payout_signature IS NULL
    AND payout_paid_at IS NULL
  )
  OR (
    payout_wallet_address IS NOT NULL
    AND payout_amount_raw > 0
    AND payout_status <> 'not_applicable'
  )
);

CREATE INDEX IF NOT EXISTS cpu_match_results_payout_status_idx
ON public.cpu_match_results (payout_status, updated_at)
WHERE payout_status IN ('pending', 'failed', 'submitted');

CREATE UNIQUE INDEX IF NOT EXISTS cpu_match_results_payout_signature_idx
ON public.cpu_match_results (payout_signature)
WHERE payout_signature IS NOT NULL;

COMMENT ON COLUMN public.cpu_match_results.points IS
  'CHESS reward amount earned for a server-validated CPU checkmate win: easy=5000, medium=10000, hard=15000.';

COMMENT ON COLUMN public.cpu_match_results.payout_wallet_address IS
  'Verified Solana wallet that should receive the automatic CPU reward payout. Null means the result is leaderboard-only.';

COMMENT ON COLUMN public.cpu_match_results.payout_amount_raw IS
  'Raw Token-2022 CHESS units for payout. CHESS uses 6 decimals, so 5000 CHESS is 5000000000 raw units.';

COMMENT ON COLUMN public.cpu_match_results.payout_status IS
  'Automatic CPU reward payout state: pending, processing, submitted, paid, failed, or not_applicable.';

COMMENT ON VIEW public.cpu_leaderboard IS
  'Aggregated People vs CPU leaderboard ordered by earned CHESS score, wins, hard wins, recency, and player tag.';
