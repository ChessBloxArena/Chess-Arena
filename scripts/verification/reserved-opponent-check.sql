BEGIN;
CREATE TEMP TABLE chessblox_seat_check (LIKE public.pvp_games INCLUDING ALL) ON COMMIT DROP;
INSERT INTO chessblox_seat_check SELECT * FROM public.pvp_games WHERE id = 'a5c03123-c890-4818-940a-248cc57a9e6c';
DO $$
BEGIN
 IF (SELECT count(*) FROM chessblox_seat_check) <> 1 THEN RAISE EXCEPTION 'Missing verification fixture'; END IF;
 UPDATE chessblox_seat_check SET black_session_id = 'isolated-seat-verification', black_wallet_address = '0x2376e2a1f858F40f3887d38655D7111EBcb55080', black_player_token_hash = repeat('a',64), payment_status = 'black_prepared';
 BEGIN
   UPDATE chessblox_seat_check SET payment_mode = NULL;
   RAISE EXCEPTION 'Incorrectly allowed a practice game with a reserved waiting seat';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   UPDATE chessblox_seat_check SET payment_status = NULL;
   RAISE EXCEPTION 'Incorrectly allowed a missing payment status';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   UPDATE chessblox_seat_check SET white_deposit_signature = NULL;
   RAISE EXCEPTION 'Incorrectly allowed a reservation without a verified deposit';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   UPDATE chessblox_seat_check SET clock_turn = 'w';
   RAISE EXCEPTION 'Incorrectly allowed the clock to run before both deposits';
 EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE chessblox_seat_check SET status='active',payment_status='both_deposited',clock_turn='w';
 UPDATE chessblox_seat_check SET status='finished',winner='b',clock_turn=NULL;
END $$;
SELECT 'Reserved seat, funded game start, finish, and invalid-state rejection checks passed; no production rows modified' AS result;
ROLLBACK;
