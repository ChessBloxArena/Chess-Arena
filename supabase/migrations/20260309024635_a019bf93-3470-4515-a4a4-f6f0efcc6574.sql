CREATE TABLE public.pvp_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  white_session_id text NOT NULL,
  black_session_id text,
  moves text[] DEFAULT '{}',
  status text DEFAULT 'waiting',
  winner text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.pvp_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read games" ON public.pvp_games FOR SELECT USING (true);
CREATE POLICY "Anyone can insert games" ON public.pvp_games FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update games" ON public.pvp_games FOR UPDATE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.pvp_games;
