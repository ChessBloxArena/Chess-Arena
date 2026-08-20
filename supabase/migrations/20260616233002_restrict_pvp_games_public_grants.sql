REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.pvp_games
FROM anon, authenticated;

GRANT SELECT ON TABLE public.pvp_games TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pvp_games TO service_role;
