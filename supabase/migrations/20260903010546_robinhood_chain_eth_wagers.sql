ALTER TABLE public.pvp_games
ADD COLUMN IF NOT EXISTS settlement_submitted_signature text;

ALTER TABLE public.pvp_games
DROP CONSTRAINT IF EXISTS pvp_games_payment_mode_check;

ALTER TABLE public.pvp_games
ADD CONSTRAINT pvp_games_payment_mode_check
CHECK (payment_mode IS NULL OR payment_mode IN ('wsol_escrow', 'native_sol_sponsored', 'robinhood_eth_escrow'));

ALTER TABLE public.pvp_games
DROP CONSTRAINT IF EXISTS pvp_games_wager_asset_kind_check;

ALTER TABLE public.pvp_games
ADD CONSTRAINT pvp_games_wager_asset_kind_check
CHECK (wager_asset_kind IS NULL OR wager_asset_kind IN ('spl_token', 'native_sol', 'native_eth'));

ALTER TABLE public.pvp_wagers
DROP CONSTRAINT IF EXISTS pvp_wagers_payment_mode_check;

ALTER TABLE public.pvp_wagers
ADD CONSTRAINT pvp_wagers_payment_mode_check
CHECK (payment_mode IS NULL OR payment_mode IN ('wsol_escrow', 'native_sol_sponsored', 'robinhood_eth_escrow'));

ALTER TABLE public.pvp_wagers
DROP CONSTRAINT IF EXISTS pvp_wagers_asset_kind_check;

ALTER TABLE public.pvp_wagers
ADD CONSTRAINT pvp_wagers_asset_kind_check
CHECK (asset_kind IS NULL OR asset_kind IN ('spl_token', 'native_sol', 'native_eth'));

CREATE INDEX IF NOT EXISTS pvp_games_robinhood_waiting_idx
ON public.pvp_games (wager_stake_raw ASC, updated_at ASC, created_at ASC)
WHERE payment_mode = 'robinhood_eth_escrow'
  AND wager_asset_kind = 'native_eth'
  AND status = 'waiting'
  AND payment_status = 'white_deposited'
  AND settlement_status = 'none'
  AND black_session_id IS NULL;

COMMENT ON COLUMN public.pvp_games.payment_mode IS
  'Wager payment lane. robinhood_eth_escrow uses native ETH escrow on Robinhood Chain (chain ID 4663).';

COMMENT ON COLUMN public.pvp_games.wager_asset_kind IS
  'Logical wager asset kind. native_eth is native Robinhood Chain ETH; winners claim ETH before any optional wallet conversion to RBLX.';

COMMENT ON COLUMN public.pvp_games.settlement_submitted_signature IS
  'Worker checkpoint for a submitted on-chain result transaction before referee verification finishes.';
