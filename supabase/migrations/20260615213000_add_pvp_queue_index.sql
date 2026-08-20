CREATE INDEX IF NOT EXISTS pvp_games_waiting_queue_idx
ON public.pvp_games (created_at ASC, updated_at DESC)
WHERE status = 'waiting' AND black_session_id IS NULL;
