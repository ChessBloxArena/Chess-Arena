DROP POLICY IF EXISTS "Anyone can read games" ON public.pvp_games;

REVOKE SELECT
ON TABLE public.pvp_games
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.pvp_games
TO service_role;

COMMENT ON TABLE public.pvp_games IS
  'Server-authoritative PvP game state. Browser clients must read player-safe game state through the pvp-referee get_game action, not directly from this base table.';
