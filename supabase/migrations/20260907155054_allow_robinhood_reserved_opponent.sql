-- A Robinhood wager reserves black's authenticated seat before accepting their
-- deposit. The chess clock must remain stopped in the waiting state meanwhile.
SET lock_timeout = '5s';
ALTER TABLE public.pvp_games DROP CONSTRAINT pvp_games_state_consistency_check;
ALTER TABLE public.pvp_games ADD CONSTRAINT pvp_games_state_consistency_check CHECK (
  status IS NULL
  OR (status = 'waiting' AND winner IS NULL AND (
    black_session_id IS NULL
    OR (
      black_session_id IS NOT NULL
      AND COALESCE(payment_mode = 'robinhood_eth_escrow', false)
      AND COALESCE(wager_asset_kind = 'native_eth', false)
      AND COALESCE(payment_status = 'black_prepared', false)
      AND white_wallet_address IS NOT NULL
      AND black_wallet_address IS NOT NULL
      AND white_wallet_address <> black_wallet_address
      AND white_player_token_hash IS NOT NULL
      AND black_player_token_hash IS NOT NULL
      AND white_deposit_signature IS NOT NULL
      AND clock_turn IS NULL
      AND clock_last_started_at IS NULL
    )
  ))
  OR (status = 'active' AND black_session_id IS NOT NULL AND winner IS NULL)
  OR (status = 'finished' AND black_session_id IS NOT NULL AND winner IN ('w', 'b', 'draw'))
  OR (status = 'cancelled' AND winner IS NULL)
) NOT VALID;
RESET lock_timeout;
