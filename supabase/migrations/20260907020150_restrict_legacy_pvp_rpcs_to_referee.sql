-- All browser game mutations now go through the authoritative Edge referee.
-- The old SQL move function does not validate chess legality.
REVOKE EXECUTE ON FUNCTION public.create_pvp_game(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.join_pvp_game(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_pvp_move(uuid, text, text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pvp_game(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_pvp_game(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_pvp_move(uuid, text, text, text, integer, text, text) TO service_role;
