ALTER TABLE public.pvp_games
ADD COLUMN IF NOT EXISTS payment_mode text,
ADD COLUMN IF NOT EXISTS wager_asset_kind text,
ADD COLUMN IF NOT EXISTS rent_sponsor_address text,
ADD COLUMN IF NOT EXISTS rent_recipient_address text,
ADD COLUMN IF NOT EXISTS sponsor_prepare_signature text,
ADD COLUMN IF NOT EXISTS white_sponsor_signature text,
ADD COLUMN IF NOT EXISTS black_sponsor_signature text,
ADD COLUMN IF NOT EXISTS cancel_sponsor_signature text,
ADD COLUMN IF NOT EXISTS rent_reclaim_status text,
ADD COLUMN IF NOT EXISTS rent_reclaim_signature text,
ADD COLUMN IF NOT EXISTS rent_reclaimed_at timestamptz,
ADD COLUMN IF NOT EXISTS sponsored_request_id text;

ALTER TABLE public.pvp_wagers
ADD COLUMN IF NOT EXISTS payment_mode text,
ADD COLUMN IF NOT EXISTS asset_kind text,
ADD COLUMN IF NOT EXISTS rent_sponsor_address text,
ADD COLUMN IF NOT EXISTS rent_recipient_address text,
ADD COLUMN IF NOT EXISTS sponsor_prepare_signature text,
ADD COLUMN IF NOT EXISTS white_sponsor_signature text,
ADD COLUMN IF NOT EXISTS black_sponsor_signature text,
ADD COLUMN IF NOT EXISTS cancel_sponsor_signature text,
ADD COLUMN IF NOT EXISTS rent_reclaim_status text,
ADD COLUMN IF NOT EXISTS rent_reclaim_signature text,
ADD COLUMN IF NOT EXISTS rent_reclaimed_at timestamptz,
ADD COLUMN IF NOT EXISTS sponsored_request_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pvp_games_payment_mode_check'
      AND conrelid = 'public.pvp_games'::regclass
  ) THEN
    ALTER TABLE public.pvp_games
    ADD CONSTRAINT pvp_games_payment_mode_check
    CHECK (payment_mode IS NULL OR payment_mode IN ('wsol_escrow', 'native_sol_sponsored'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pvp_games_wager_asset_kind_check'
      AND conrelid = 'public.pvp_games'::regclass
  ) THEN
    ALTER TABLE public.pvp_games
    ADD CONSTRAINT pvp_games_wager_asset_kind_check
    CHECK (wager_asset_kind IS NULL OR wager_asset_kind IN ('spl_token', 'native_sol'));
  END IF;

  ALTER TABLE public.pvp_games
  DROP CONSTRAINT IF EXISTS pvp_games_rent_reclaim_status_check;

  ALTER TABLE public.pvp_games
  ADD CONSTRAINT pvp_games_rent_reclaim_status_check
  CHECK (
    rent_reclaim_status IS NULL OR rent_reclaim_status IN (
      'not_applicable',
      'pending',
      'reclaiming',
      'reclaimed',
      'failed',
      'unknown'
    )
  );

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pvp_wagers_payment_mode_check'
      AND conrelid = 'public.pvp_wagers'::regclass
  ) THEN
    ALTER TABLE public.pvp_wagers
    ADD CONSTRAINT pvp_wagers_payment_mode_check
    CHECK (payment_mode IS NULL OR payment_mode IN ('wsol_escrow', 'native_sol_sponsored'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pvp_wagers_asset_kind_check'
      AND conrelid = 'public.pvp_wagers'::regclass
  ) THEN
    ALTER TABLE public.pvp_wagers
    ADD CONSTRAINT pvp_wagers_asset_kind_check
    CHECK (asset_kind IS NULL OR asset_kind IN ('spl_token', 'native_sol'));
  END IF;

  ALTER TABLE public.pvp_wagers
  DROP CONSTRAINT IF EXISTS pvp_wagers_rent_reclaim_status_check;

  ALTER TABLE public.pvp_wagers
  ADD CONSTRAINT pvp_wagers_rent_reclaim_status_check
  CHECK (
    rent_reclaim_status IS NULL OR rent_reclaim_status IN (
      'not_applicable',
      'pending',
      'reclaiming',
      'reclaimed',
      'failed',
      'unknown'
    )
  );
END $$;

CREATE INDEX IF NOT EXISTS pvp_games_sponsored_native_waiting_idx
ON public.pvp_games (
  wager_stake_raw ASC,
  updated_at ASC,
  created_at ASC
)
WHERE
  payment_mode = 'native_sol_sponsored'
  AND wager_asset_kind = 'native_sol'
  AND status = 'waiting'
  AND payment_status = 'white_deposited'
  AND settlement_status = 'none'
  AND black_session_id IS NULL;

CREATE INDEX IF NOT EXISTS pvp_games_sponsored_rent_reconcile_idx
ON public.pvp_games (rent_reclaim_status ASC, settlement_status ASC, updated_at ASC)
WHERE payment_mode = 'native_sol_sponsored'
  AND rent_reclaim_status IN ('pending', 'reclaiming', 'failed', 'unknown');

CREATE INDEX IF NOT EXISTS pvp_games_sponsored_request_idx
ON public.pvp_games (sponsored_request_id ASC)
WHERE sponsored_request_id IS NOT NULL;

COMMENT ON COLUMN public.pvp_games.payment_mode IS
  'Wager payment lane. native_sol_sponsored means the platform sponsors transaction fees and temporary account rent.';

COMMENT ON COLUMN public.pvp_games.wager_asset_kind IS
  'Logical wager asset kind. native_sol distinguishes sponsored SOL wagers from the legacy wSOL token escrow path.';

COMMENT ON COLUMN public.pvp_games.rent_sponsor_address IS
  'Public sponsor/rent payer address used for sponsored native SOL wager transactions.';

COMMENT ON COLUMN public.pvp_games.rent_recipient_address IS
  'Trusted public address that receives reclaimed temporary escrow rent when a sponsored native SOL wager closes.';

COMMENT ON COLUMN public.pvp_games.rent_reclaim_status IS
  'Referee/worker audit status for reclaiming sponsored temporary account rent after terminal wager states.';
