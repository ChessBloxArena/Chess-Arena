ALTER TABLE public.pvp_games
ADD COLUMN IF NOT EXISTS white_wallet_address text,
ADD COLUMN IF NOT EXISTS black_wallet_address text,
ADD COLUMN IF NOT EXISTS wager_asset_mint text,
ADD COLUMN IF NOT EXISTS wager_asset_symbol text,
ADD COLUMN IF NOT EXISTS wager_asset_decimals smallint,
ADD COLUMN IF NOT EXISTS wager_stake_raw text,
ADD COLUMN IF NOT EXISTS escrow_contest_id text,
ADD COLUMN IF NOT EXISTS payment_status text,
ADD COLUMN IF NOT EXISTS white_deposit_signature text,
ADD COLUMN IF NOT EXISTS black_deposit_signature text,
ADD COLUMN IF NOT EXISTS refund_signature text,
ADD COLUMN IF NOT EXISTS settlement_status text,
ADD COLUMN IF NOT EXISTS settlement_signature text,
ADD COLUMN IF NOT EXISTS result_hash text,
ADD COLUMN IF NOT EXISTS result_reason text,
ADD COLUMN IF NOT EXISTS clock_initial_ms integer,
ADD COLUMN IF NOT EXISTS clock_increment_ms integer,
ADD COLUMN IF NOT EXISTS white_clock_ms integer,
ADD COLUMN IF NOT EXISTS black_clock_ms integer,
ADD COLUMN IF NOT EXISTS clock_turn text,
ADD COLUMN IF NOT EXISTS clock_started_at timestamptz,
ADD COLUMN IF NOT EXISTS clock_last_started_at timestamptz,
ADD COLUMN IF NOT EXISTS timeout_claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS pvp_games_wager_waiting_matchmaking_idx
ON public.pvp_games (
  wager_asset_mint ASC,
  wager_stake_raw ASC,
  updated_at ASC,
  created_at ASC
)
WHERE
  status = 'waiting'
  AND payment_status = 'white_deposited'
  AND black_session_id IS NULL
  AND wager_asset_mint IS NOT NULL
  AND wager_stake_raw IS NOT NULL;

CREATE INDEX IF NOT EXISTS pvp_games_wager_settlement_idx
ON public.pvp_games (settlement_status ASC, updated_at ASC)
WHERE payment_status = 'both_deposited'
  AND settlement_status IN ('pending', 'failed');

CREATE TABLE public.pvp_wagers (
  game_id uuid PRIMARY KEY REFERENCES public.pvp_games(id) ON DELETE CASCADE,
  white_wallet_address text NOT NULL,
  black_wallet_address text,
  asset_mint text NOT NULL,
  asset_symbol text NOT NULL,
  asset_decimals smallint NOT NULL,
  token_program text NOT NULL,
  stake_amount_raw numeric(20, 0) NOT NULL,
  escrow_contest_id text,
  wager_status text NOT NULL DEFAULT 'preparing',
  payment_status text NOT NULL DEFAULT 'not_started',
  settlement_status text NOT NULL DEFAULT 'not_started',
  refund_status text NOT NULL DEFAULT 'none',
  unwrap_status text NOT NULL DEFAULT 'not_requested',
  white_deposit_signature text,
  black_deposit_signature text,
  white_refund_signature text,
  black_refund_signature text,
  settlement_signature text,
  white_unwrap_signature text,
  black_unwrap_signature text,
  result_hash text,
  clock_initial_ms integer NOT NULL DEFAULT 600000,
  white_clock_ms integer NOT NULL DEFAULT 600000,
  black_clock_ms integer NOT NULL DEFAULT 600000,
  active_color text,
  clock_started_at timestamptz,
  last_clock_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pvp_wagers_white_wallet_address_check
    CHECK (length(white_wallet_address) BETWEEN 32 AND 44),
  CONSTRAINT pvp_wagers_black_wallet_address_check
    CHECK (black_wallet_address IS NULL OR length(black_wallet_address) BETWEEN 32 AND 44),
  CONSTRAINT pvp_wagers_asset_mint_check
    CHECK (length(asset_mint) BETWEEN 32 AND 44),
  CONSTRAINT pvp_wagers_asset_symbol_check
    CHECK (length(asset_symbol) BETWEEN 1 AND 16),
  CONSTRAINT pvp_wagers_asset_decimals_check
    CHECK (asset_decimals BETWEEN 0 AND 18),
  CONSTRAINT pvp_wagers_token_program_check
    CHECK (length(token_program) BETWEEN 32 AND 44),
  CONSTRAINT pvp_wagers_stake_amount_raw_check
    CHECK (stake_amount_raw > 0),
  CONSTRAINT pvp_wagers_escrow_contest_id_unique UNIQUE (escrow_contest_id),
  CONSTRAINT pvp_wagers_wager_status_check
    CHECK (
      wager_status IN (
        'preparing',
        'waiting_for_white_deposit',
        'waiting_for_opponent',
        'waiting_for_black_deposit',
        'funded',
        'active',
        'cancelled',
        'expired',
        'settling',
        'settled',
        'refund_pending',
        'refunded',
        'failed'
      )
    ),
  CONSTRAINT pvp_wagers_payment_status_check
    CHECK (
      payment_status IN (
        'not_started',
        'white_deposit_pending',
        'white_deposited',
        'black_deposit_pending',
        'both_deposited',
        'cancel_pending',
        'cancelled',
        'refund_pending',
        'refunded',
        'failed'
      )
    ),
  CONSTRAINT pvp_wagers_settlement_status_check
    CHECK (
      settlement_status IN (
        'not_started',
        'pending_result',
        'settlement_pending',
        'settled',
        'draw_refund_pending',
        'refunded',
        'failed'
      )
    ),
  CONSTRAINT pvp_wagers_refund_status_check
    CHECK (
      refund_status IN (
        'none',
        'white_pending',
        'black_pending',
        'both_pending',
        'white_refunded',
        'black_refunded',
        'refunded',
        'failed'
      )
    ),
  CONSTRAINT pvp_wagers_unwrap_status_check
    CHECK (
      unwrap_status IN (
        'not_requested',
        'white_requested',
        'black_requested',
        'both_requested',
        'white_unwrapped',
        'black_unwrapped',
        'complete',
        'failed'
      )
    ),
  CONSTRAINT pvp_wagers_active_color_check
    CHECK (active_color IS NULL OR active_color IN ('w', 'b')),
  CONSTRAINT pvp_wagers_clock_initial_ms_check
    CHECK (clock_initial_ms > 0),
  CONSTRAINT pvp_wagers_white_clock_ms_check
    CHECK (white_clock_ms >= 0),
  CONSTRAINT pvp_wagers_black_clock_ms_check
    CHECK (black_clock_ms >= 0),
  CONSTRAINT pvp_wagers_clock_bounds_check
    CHECK (white_clock_ms <= clock_initial_ms AND black_clock_ms <= clock_initial_ms),
  CONSTRAINT pvp_wagers_result_hash_check
    CHECK (result_hash IS NULL OR length(result_hash) BETWEEN 32 AND 128)
);

COMMENT ON TABLE public.pvp_wagers IS
  'Server-authoritative wager/payment state for PvP games. Browser clients may read this table for realtime UI updates, but writes must go through trusted referee/service-role code.';

COMMENT ON COLUMN public.pvp_wagers.stake_amount_raw IS
  'Stake amount in the active asset base units. For SOL wagers this is lamports/wSOL base units.';

COMMENT ON COLUMN public.pvp_wagers.escrow_contest_id IS
  'Deterministic escrow contest identifier produced by trusted wager/referee code.';

COMMENT ON COLUMN public.pvp_wagers.result_hash IS
  'Hash of the canonical final game result used by trusted settlement code.';

ALTER TABLE public.pvp_wagers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pvp_wagers REPLICA IDENTITY FULL;

REVOKE ALL ON public.pvp_wagers FROM PUBLIC;
REVOKE ALL ON public.pvp_wagers FROM anon, authenticated;
GRANT SELECT ON public.pvp_wagers TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pvp_wagers TO service_role;

DROP POLICY IF EXISTS "Anyone can read wager state" ON public.pvp_wagers;
CREATE POLICY "Anyone can read wager state"
ON public.pvp_wagers
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Service role can manage wager state" ON public.pvp_wagers;
CREATE POLICY "Service role can manage wager state"
ON public.pvp_wagers
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS pvp_wagers_waiting_matchmaking_idx
ON public.pvp_wagers (
  stake_amount_raw ASC,
  asset_mint ASC,
  updated_at ASC,
  game_id ASC
)
WHERE
  wager_status = 'waiting_for_opponent'
  AND payment_status = 'white_deposited'
  AND black_wallet_address IS NULL;

CREATE INDEX IF NOT EXISTS pvp_wagers_status_freshness_idx
ON public.pvp_wagers (wager_status ASC, updated_at DESC, created_at ASC)
WHERE wager_status IN (
  'preparing',
  'waiting_for_white_deposit',
  'waiting_for_opponent',
  'waiting_for_black_deposit',
  'funded',
  'active',
  'settling',
  'refund_pending'
);

CREATE INDEX IF NOT EXISTS pvp_wagers_asset_stake_status_idx
ON public.pvp_wagers (
  asset_mint ASC,
  stake_amount_raw ASC,
  wager_status ASC,
  updated_at ASC
)
WHERE wager_status IN (
  'waiting_for_opponent',
  'waiting_for_black_deposit',
  'funded',
  'active'
);

CREATE INDEX IF NOT EXISTS pvp_wagers_settlement_status_idx
ON public.pvp_wagers (settlement_status ASC, updated_at ASC)
WHERE settlement_status IN (
  'pending_result',
  'settlement_pending',
  'draw_refund_pending',
  'failed'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pvp_wagers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pvp_wagers;
  END IF;
END $$;
