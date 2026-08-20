ALTER TABLE public.pvp_games
ADD COLUMN IF NOT EXISTS white_player_token_hash text,
ADD COLUMN IF NOT EXISTS black_player_token_hash text;

DROP POLICY IF EXISTS "Anyone can insert games" ON public.pvp_games;
DROP POLICY IF EXISTS "Anyone can update games" ON public.pvp_games;

COMMENT ON COLUMN public.pvp_games.white_player_token_hash IS
  'SHA-256 hash of the private per-game token for the white player. Raw tokens must only live in browser storage and referee requests.';

COMMENT ON COLUMN public.pvp_games.black_player_token_hash IS
  'SHA-256 hash of the private per-game token for the black player. Raw tokens must only live in browser storage and referee requests.';
