-- Harden browser PvP writes behind RPCs. Anonymous users may still read games
-- for lobby/realtime purposes, but they can no longer insert or update rows
-- directly with arbitrary seat, move, status, or winner data.

DROP POLICY IF EXISTS "Anyone can insert games" ON public.pvp_games;
DROP POLICY IF EXISTS "Anyone can update games" ON public.pvp_games;

REVOKE INSERT, UPDATE, DELETE ON public.pvp_games FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pvp_games TO anon, authenticated;

CREATE TABLE public.pvp_game_seats (
  game_id uuid NOT NULL REFERENCES public.pvp_games(id) ON DELETE CASCADE,
  color text NOT NULL CHECK (color IN ('w', 'b')),
  session_id text NOT NULL CHECK (length(btrim(session_id)) BETWEEN 1 AND 128),
  player_token text NOT NULL CHECK (length(btrim(player_token)) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, color),
  UNIQUE (game_id, session_id),
  UNIQUE (game_id, player_token)
);

ALTER TABLE public.pvp_game_seats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pvp_game_seats FROM PUBLIC, anon, authenticated;

CREATE TYPE public.pvp_game_with_token AS (
  id uuid,
  white_session_id text,
  black_session_id text,
  moves text[],
  status text,
  winner text,
  created_at timestamptz,
  updated_at timestamptz,
  player_color text,
  player_token text
);

REVOKE ALL ON TYPE public.pvp_game_with_token FROM PUBLIC;
GRANT USAGE ON TYPE public.pvp_game_with_token TO anon, authenticated;

ALTER TABLE public.pvp_games
  ADD CONSTRAINT pvp_games_status_check
  CHECK (status IS NULL OR status IN ('waiting', 'active', 'finished')) NOT VALID,
  ADD CONSTRAINT pvp_games_winner_check
  CHECK (winner IS NULL OR winner IN ('w', 'b', 'draw')) NOT VALID,
  ADD CONSTRAINT pvp_games_session_id_check
  CHECK (
    length(btrim(white_session_id)) BETWEEN 1 AND 128
    AND (
      black_session_id IS NULL
      OR length(btrim(black_session_id)) BETWEEN 1 AND 128
    )
    AND (
      black_session_id IS NULL
      OR black_session_id <> white_session_id
    )
  ) NOT VALID,
  ADD CONSTRAINT pvp_games_state_consistency_check
  CHECK (
    status IS NULL
    OR (
      status = 'waiting'
      AND black_session_id IS NULL
      AND winner IS NULL
    )
    OR (
      status = 'active'
      AND black_session_id IS NOT NULL
      AND winner IS NULL
    )
    OR (
      status = 'finished'
      AND black_session_id IS NOT NULL
      AND winner IN ('w', 'b', 'draw')
    )
  ) NOT VALID,
  ADD CONSTRAINT pvp_games_moves_check
  CHECK (moves IS NULL OR array_position(moves, NULL::text) IS NULL) NOT VALID;

CREATE OR REPLACE FUNCTION public.create_pvp_game(p_white_session_id text)
RETURNS public.pvp_game_with_token
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_white_session_id text := nullif(btrim(p_white_session_id), '');
  v_player_token text := gen_random_uuid()::text;
  v_game public.pvp_games;
BEGIN
  IF v_white_session_id IS NULL THEN
    RAISE EXCEPTION 'white session id is required' USING ERRCODE = '22023';
  END IF;

  IF length(v_white_session_id) > 128 THEN
    RAISE EXCEPTION 'white session id is too long' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.pvp_games (
    white_session_id,
    black_session_id,
    moves,
    status,
    winner,
    updated_at
  )
  VALUES (
    v_white_session_id,
    NULL,
    ARRAY[]::text[],
    'waiting',
    NULL,
    now()
  )
  RETURNING * INTO v_game;

  INSERT INTO public.pvp_game_seats (
    game_id,
    color,
    session_id,
    player_token
  )
  VALUES (
    v_game.id,
    'w',
    v_white_session_id,
    v_player_token
  );

  RETURN (
    v_game.id,
    v_game.white_session_id,
    v_game.black_session_id,
    v_game.moves,
    v_game.status,
    v_game.winner,
    v_game.created_at,
    v_game.updated_at,
    'w',
    v_player_token
  )::public.pvp_game_with_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_pvp_game(
  p_game_id uuid,
  p_black_session_id text,
  p_expected_moves_length integer DEFAULT 0
)
RETURNS public.pvp_game_with_token
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_black_session_id text := nullif(btrim(p_black_session_id), '');
  v_player_token text := gen_random_uuid()::text;
  v_game public.pvp_games;
  v_moves_length integer;
BEGIN
  IF v_black_session_id IS NULL THEN
    RAISE EXCEPTION 'black session id is required' USING ERRCODE = '22023';
  END IF;

  IF length(v_black_session_id) > 128 THEN
    RAISE EXCEPTION 'black session id is too long' USING ERRCODE = '22023';
  END IF;

  IF p_expected_moves_length IS NULL OR p_expected_moves_length < 0 THEN
    RAISE EXCEPTION 'expected moves length must be a non-negative integer' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_game
  FROM public.pvp_games
  WHERE id = p_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game not found' USING ERRCODE = 'P0002';
  END IF;

  v_moves_length := coalesce(cardinality(v_game.moves), 0);

  IF v_moves_length <> p_expected_moves_length THEN
    RAISE EXCEPTION 'stale game state: expected % moves, found %', p_expected_moves_length, v_moves_length
      USING ERRCODE = '40001';
  END IF;

  IF v_game.status IS DISTINCT FROM 'waiting' OR v_game.black_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'game is not joinable' USING ERRCODE = '23514';
  END IF;

  IF v_game.white_session_id = v_black_session_id THEN
    RAISE EXCEPTION 'black session id must differ from white session id' USING ERRCODE = '23514';
  END IF;

  UPDATE public.pvp_games
  SET
    black_session_id = v_black_session_id,
    status = 'active',
    winner = NULL,
    updated_at = now()
  WHERE id = p_game_id
  RETURNING * INTO v_game;

  INSERT INTO public.pvp_game_seats (
    game_id,
    color,
    session_id,
    player_token
  )
  VALUES (
    v_game.id,
    'b',
    v_black_session_id,
    v_player_token
  );

  RETURN (
    v_game.id,
    v_game.white_session_id,
    v_game.black_session_id,
    v_game.moves,
    v_game.status,
    v_game.winner,
    v_game.created_at,
    v_game.updated_at,
    'b',
    v_player_token
  )::public.pvp_game_with_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_pvp_move(
  p_game_id uuid,
  p_session_id text,
  p_player_token text,
  p_move_san text,
  p_expected_moves_length integer,
  p_result_status text DEFAULT 'active',
  p_result_winner text DEFAULT NULL
)
RETURNS public.pvp_games
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id text := nullif(btrim(p_session_id), '');
  v_player_token text := nullif(btrim(p_player_token), '');
  v_move_san text := nullif(btrim(p_move_san), '');
  v_result_status text := coalesce(nullif(btrim(p_result_status), ''), 'active');
  v_result_winner text := nullif(btrim(p_result_winner), '');
  v_game public.pvp_games;
  v_seat public.pvp_game_seats;
  v_moves_length integer;
  v_turn text;
BEGIN
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'session id is required' USING ERRCODE = '22023';
  END IF;

  IF length(v_session_id) > 128 THEN
    RAISE EXCEPTION 'session id is too long' USING ERRCODE = '22023';
  END IF;

  IF v_player_token IS NULL THEN
    RAISE EXCEPTION 'player token is required' USING ERRCODE = '22023';
  END IF;

  IF length(v_player_token) > 128 THEN
    RAISE EXCEPTION 'player token is too long' USING ERRCODE = '22023';
  END IF;

  IF v_move_san IS NULL THEN
    RAISE EXCEPTION 'move SAN is required' USING ERRCODE = '22023';
  END IF;

  IF length(v_move_san) > 20 THEN
    RAISE EXCEPTION 'move SAN is too long' USING ERRCODE = '22023';
  END IF;

  -- This validates SAN shape and blocks arbitrary payload strings. Full chess
  -- legality still belongs in a chess engine or trusted client until a server
  -- chess validator is introduced.
  IF v_move_san !~ '^(O-O(-O)?[+#]?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?[+#]?|[KQRBN]?[a-h]?[1-8]?[a-h][1-8](=[QRBN])?[+#]?)$' THEN
    RAISE EXCEPTION 'move SAN has an invalid shape' USING ERRCODE = '22023';
  END IF;

  IF p_expected_moves_length IS NULL OR p_expected_moves_length < 0 THEN
    RAISE EXCEPTION 'expected moves length must be a non-negative integer' USING ERRCODE = '22023';
  END IF;

  IF v_result_status NOT IN ('active', 'finished') THEN
    RAISE EXCEPTION 'result status must be active or finished' USING ERRCODE = '22023';
  END IF;

  IF v_result_status = 'active' AND v_result_winner IS NOT NULL THEN
    RAISE EXCEPTION 'active games cannot have a winner' USING ERRCODE = '23514';
  END IF;

  IF v_result_status = 'finished' AND v_result_winner IS NULL THEN
    RAISE EXCEPTION 'finished games require a winner' USING ERRCODE = '23514';
  END IF;

  IF v_result_winner IS NOT NULL AND v_result_winner NOT IN ('w', 'b', 'draw') THEN
    RAISE EXCEPTION 'winner must be w, b, or draw' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_game
  FROM public.pvp_games
  WHERE id = p_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_game.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'game is not active' USING ERRCODE = '23514';
  END IF;

  IF v_game.black_session_id IS NULL THEN
    RAISE EXCEPTION 'game has no black player' USING ERRCODE = '23514';
  END IF;

  v_moves_length := coalesce(cardinality(v_game.moves), 0);

  IF v_moves_length <> p_expected_moves_length THEN
    RAISE EXCEPTION 'stale game state: expected % moves, found %', p_expected_moves_length, v_moves_length
      USING ERRCODE = '40001';
  END IF;

  v_turn := CASE WHEN v_moves_length % 2 = 0 THEN 'w' ELSE 'b' END;

  IF (
    v_turn = 'w'
    AND v_game.white_session_id IS DISTINCT FROM v_session_id
  ) OR (
    v_turn = 'b'
    AND v_game.black_session_id IS DISTINCT FROM v_session_id
  ) THEN
    RAISE EXCEPTION 'session does not own the current turn' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_seat
  FROM public.pvp_game_seats
  WHERE game_id = p_game_id
    AND color = v_turn;

  IF NOT FOUND
    OR v_seat.session_id IS DISTINCT FROM v_session_id
    OR v_seat.player_token IS DISTINCT FROM v_player_token THEN
    RAISE EXCEPTION 'player token does not own the current turn' USING ERRCODE = '42501';
  END IF;

  IF v_result_status = 'finished'
    AND v_result_winner IN ('w', 'b')
    AND v_result_winner <> v_turn THEN
    RAISE EXCEPTION 'winning color must match the moving player' USING ERRCODE = '23514';
  END IF;

  UPDATE public.pvp_games
  SET
    moves = array_append(coalesce(v_game.moves, ARRAY[]::text[]), v_move_san),
    status = v_result_status,
    winner = CASE WHEN v_result_status = 'finished' THEN v_result_winner ELSE NULL END,
    updated_at = now()
  WHERE id = p_game_id
  RETURNING * INTO v_game;

  RETURN v_game;
END;
$$;

COMMENT ON TABLE public.pvp_game_seats
IS 'Private per-seat browser tokens for anonymous PvP ownership. Public clients must use create/join RPCs to receive a token; direct table access is denied.';

COMMENT ON FUNCTION public.submit_pvp_move(uuid, text, text, text, integer, text, text)
IS 'Appends exactly one SAN-shaped move after private seat-token, turn, status, and expected-ply checks. It does not fully validate chess legality in SQL.';

REVOKE ALL ON FUNCTION public.create_pvp_game(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_pvp_game(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_pvp_move(uuid, text, text, text, integer, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_pvp_game(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_pvp_game(uuid, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_pvp_move(uuid, text, text, text, integer, text, text) TO anon, authenticated;
