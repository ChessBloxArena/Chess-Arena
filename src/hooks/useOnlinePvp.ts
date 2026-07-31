import { clearPendingRobinhoodWager } from "@/lib/robinhoodPendingWager";
import { robinhoodEscrowAddress } from "@/lib/robinhoodChain";
import { useState, useEffect, useCallback, useRef } from 'react';
import { Chess, Square, PieceSymbol, Move } from 'chess.js';
import { PublicKey, Transaction } from '@solana/web3.js';
import { supabase } from '@/integrations/supabase/client';
import { playMoveSound, playCaptureSound, playCheckSound, playGameOverSound, playIllegalMoveSound } from '@/lib/sounds';
import { deriveWagerSettlementSummary } from '@/lib/wagerSettlement';
import { clearStoredPvpSession, ensurePvpSession, getPvpSessionIdSync, isInvalidPvpSessionError } from '@/lib/pvpSession';
import { buildMoveFeedback, type MoveFeedback } from '@/lib/moveFeedback';
import { buildInvalidMoveFeedback, type InvalidMoveFeedback } from '@/lib/invalidMoveFeedback';
import {
  buildSignedCancelRequest,
  buildSignedRefundRequest,
  cancelSponsoredWager,
  cancelWagerWaiting,
  enterWagerLobby,
  enterWagerLobbyHost,
  enterWagerQueue,
  resolveBrowserEscrowFactory,
  settleFinishedWager,
  signWalletProof,
  type EnterWagerQueueArgs,
} from '@/lib/wagerRefereeClient';
import { getWagerConfig } from '@/lib/wagerConfig';
import {
  cancelRobinhoodWager,
  claimRobinhoodEth,
  enterRobinhoodWagerQueue,
  hostRobinhoodWagerLobby,
  joinRobinhoodWagerLobby,
  refundExpiredRobinhoodWager,
  swapRobinhoodPrizeForRblx,
  getRobinhoodRblxQuote,
  type RblxSwapQuote,
  type EnterRobinhoodWagerArgs,
  type RobinhoodWalletActions,
} from '@/lib/robinhoodWagerClient';
import type { Address, Hash, Hex } from 'viem';
import type { PendingPromotion } from './useChessGame';
import type { PromotionPiece } from '@/components/PromotionPicker';

export interface CapturedPieces {
  w: PieceSymbol[];
  b: PieceSymbol[];
}

type PlayerColor = 'w' | 'b';
export type OnlineConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

export function getPvpSessionId(): string {
  return getPvpSessionIdSync();
}

interface PvpGameRow {
  [key: string]: unknown;
  id: string;
  white_player_present?: boolean | null;
  black_player_present?: boolean | null;
  moves: string[] | null;
  status: string | null;
  winner: string | null;
  created_at: string | null;
  updated_at: string | null;
  white_wallet_address?: string | null;
  black_wallet_address?: string | null;
  payment_status?: string | null;
  settlement_status?: string | null;
  refund_status?: string | null;
  refund_signature?: string | null;
  refund_error?: string | null;
  white_deposit_signature?: string | null;
  black_deposit_signature?: string | null;
  settlement_signature?: string | null;
  result_reason?: string | null;
  wager_asset_mint?: string | null;
  wager_asset_symbol?: string | null;
  wager_asset_decimals?: number | string | null;
  wager_stake_raw?: string | null;
  escrow_contest_id?: string | null;
  robinhood_escrow_address?: string | null;
  payout_mode?: string | null;
  payment_mode?: string | null;
  white_clock_ms?: number | string | null;
  black_clock_ms?: number | string | null;
  clock_turn?: PlayerColor | string | null;
  clock_last_started_at?: string | null;
  timeout_claimed_at?: string | null;
}

export interface WalletActionContext {
  publicKey?: PublicKey | null;
  address?: Address | null;
  connect: () => Promise<PublicKey | Address | null>;
  signAndSendTransaction?: (transaction: Transaction) => Promise<string>;
  writeContract?: (request: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
  }) => Promise<Hash>;
  sendTransaction?: (request: {
    to: Address;
    data: Hex;
    value: bigint;
  }) => Promise<Hash>;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
}

interface PvpCredential {
  gameId: string;
  color: PlayerColor;
  playerToken: string;
  updatedAt: number;
}

export type PvpLobbyMatchType = 'free' | 'wager';
export type PvpLobbyAccess = 'open' | 'invite' | 'holder';
export type PvpLobbyColor = 'random' | 'white' | 'black';

export interface PvpLobby {
  id: string;
  gameId: string;
  name: string;
  hostName: string;
  matchType: PvpLobbyMatchType;
  access: PvpLobbyAccess;
  color: PvpLobbyColor;
  formatId?: string;
  formatFamily?: string;
  formatLabel?: string;
  timeControl: string;
  stakeRaw?: string | null;
  stakeLabel?: string | null;
  assetSymbol?: string | null;
  status: string;
  gameStatus?: string | null;
  paymentStatus?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  expiresAt?: string | null;
}

export interface PvpQueueCount {
  matchType: PvpLobbyMatchType;
  formatId: string;
  formatFamily: string;
  formatLabel: string;
  timeControl: string;
  stakeRaw?: string | null;
  assetSymbol?: string | null;
  players: number;
}

export interface CreatePvpLobbyInput {
  name: string;
  hostName: string;
  matchType: PvpLobbyMatchType;
  access: PvpLobbyAccess;
  color: PvpLobbyColor;
  timeControl: string;
  gameId?: string;
  stakeRaw?: string;
  stakeLabel?: string;
  assetSymbol?: string;
}

interface RefereeJoinResponse {
  gameId: string;
  color: PlayerColor;
  playerToken: string;
  game: PvpGameRow;
}

interface RefereeGameResponse {
  ok?: boolean;
  move?: string;
  game: PvpGameRow;
}

interface RefereeHeartbeatResponse extends RefereeGameResponse {
  gameId?: string;
  color?: PlayerColor;
  playerToken?: string;
}

interface RefereeLobbyListResponse {
  ok?: boolean;
  lobbies: PvpLobby[];
  queueCounts?: PvpQueueCount[];
}

interface RefereeLobbyJoinResponse extends Partial<RefereeJoinResponse> {
  ok?: boolean;
  requiresWager?: boolean;
  gameId: string;
  lobby: PvpLobby;
}

interface RefereeRequest {
  action:
    | 'get_game'
    | 'join_queue'
    | 'join_game'
    | 'create_lobby'
    | 'list_lobbies'
    | 'join_lobby'
    | 'cancel_lobby'
    | 'heartbeat_lobby'
    | 'heartbeat'
    | 'cancel_waiting'
    | 'move'
    | 'claim_timeout'
    | 'resign';
  gameId?: string;
  lobbyId?: string;
  lobbyName?: string;
  hostName?: string;
  matchType?: PvpLobbyMatchType;
  access?: PvpLobbyAccess;
  preferredColor?: PvpLobbyColor;
  timeControl?: string;
  stakeRaw?: string;
  stakeLabel?: string;
  assetSymbol?: string;
  sessionId?: string;
  playerToken?: string;
  reuseGameId?: string;
  from?: string;
  to?: string;
  promotion?: string;
  expectedPly?: number;
  requestId?: string;
  sessionProof?: string;
  walletAddress?: string;
  walletSignature?: string;
  walletProofNonce?: string;
  walletProofExpiresAt?: string;
}

const QUEUE_TIMEOUT_MS = 90_000;
const DEFAULT_WAGER_CLOCK_MS = 10 * 60 * 1000;
const PVP_CREDENTIALS_KEY = 'chess_pvp_credentials_v1';
const PVP_REFEREE_FUNCTION = 'pvp-referee';

function readCredentialStore(): Record<string, PvpCredential> {
  try {
    const raw = localStorage.getItem(PVP_CREDENTIALS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCredentialStore(store: Record<string, PvpCredential>): void {
  localStorage.setItem(PVP_CREDENTIALS_KEY, JSON.stringify(store));
}

function getGameCredential(gameId: string | undefined): PvpCredential | null {
  if (!gameId) return null;
  return readCredentialStore()[gameId] ?? null;
}

function saveGameCredential(response: RefereeJoinResponse): PvpCredential {
  const credential: PvpCredential = {
    gameId: response.gameId,
    color: response.color,
    playerToken: response.playerToken,
    updatedAt: Date.now(),
  };
  const store = readCredentialStore();
  store[credential.gameId] = credential;
  writeCredentialStore(store);
  return credential;
}

function removeGameCredential(gameId: string): void {
  const store = readCredentialStore();
  delete store[gameId];
  writeCredentialStore(store);
}

function numberFrom(value: number | string | null | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function formatClock(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function wagerTerms(row: PvpGameRow) {
  if (!row.wager_asset_mint || !row.wager_stake_raw || !row.escrow_contest_id) {
    throw new Error('Wager terms missing from game state.');
  }
  return {
    assetMint: row.wager_asset_mint,
    stakeLamports: BigInt(row.wager_stake_raw),
    escrowContestId: row.escrow_contest_id,
    tokenProgramId: getWagerConfig().asset.tokenProgramId,
  };
}

function isSponsoredWager(row: PvpGameRow): boolean {
  return row.payment_mode === 'native_sol_sponsored';
}

function isRobinhoodWager(row: PvpGameRow): boolean {
  return row.payment_mode === 'robinhood_eth_escrow';
}

async function requireWallet(ctx?: WalletActionContext): Promise<PublicKey> {
  if (!ctx) throw new Error('Connect the wager wallet before signing.');
  const walletPublicKey = ctx.publicKey ?? await ctx.connect();
  if (!(walletPublicKey instanceof PublicKey)) throw new Error('Connect the Solana wager wallet before signing.');
  return walletPublicKey;
}

async function requireRobinhoodWallet(ctx?: WalletActionContext): Promise<RobinhoodWalletActions> {
  if (!ctx) throw new Error('Connect the Robinhood Chain wallet before signing.');
  const connected = ctx.address ?? await ctx.connect();
  if (typeof connected !== 'string' || !connected.startsWith('0x') || !ctx.writeContract || !ctx.signMessage) {
    throw new Error('Connect an EVM wallet on Robinhood Chain before signing.');
  }
  return { address: connected as Address, writeContract: ctx.writeContract, sendTransaction: ctx.sendTransaction, signMessage: ctx.signMessage };
}

function requireWalletMessageSigner(ctx?: WalletActionContext): (message: Uint8Array) => Promise<Uint8Array> {
  if (!ctx?.signMessage) throw new Error('This wallet must support message signing for wagered PvP.');
  return ctx.signMessage;
}

async function invokePvpReferee<T>(body: RefereeRequest, retryInvalidSession = true): Promise<T> {
  const session = await ensurePvpSession();
  const { data, error } = await supabase.functions.invoke(PVP_REFEREE_FUNCTION, {
    body: {
      ...body,
      sessionId: session.sessionId,
      sessionProof: session.sessionProof,
    },
  });

  if (error) {
    let message = error.message || 'Referee request failed';
    let code: string | undefined;
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const responseBody = await context.clone().json();
        if (responseBody?.error) message = responseBody.error;
        if (responseBody?.code) code = String(responseBody.code);
      } catch {
        // Keep the SDK error message when the function did not return JSON.
      }
    }
    if (retryInvalidSession && isInvalidPvpSessionError(code, message)) {
      clearStoredPvpSession();
      return invokePvpReferee<T>(body, false);
    }
    throw new Error(message);
  }

  if (data && typeof data === 'object' && 'error' in data) {
    const response = data as { error: unknown; code?: unknown };
    const message = String(response.error);
    const code = response.code ? String(response.code) : undefined;
    if (retryInvalidSession && isInvalidPvpSessionError(code, message)) {
      clearStoredPvpSession();
      return invokePvpReferee<T>(body, false);
    }
    throw new Error(message);
  }

  return data as T;
}

function reusableWaitingCredential(): PvpCredential | null {
  const cutoff = Date.now() - QUEUE_TIMEOUT_MS;
  return Object.values(readCredentialStore())
    .filter((credential) => credential.color === 'w' && credential.updatedAt > cutoff)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

async function joinExistingGame(
  gameId: string,
  sessionId: string,
  playerToken?: string
): Promise<RefereeJoinResponse> {
  return invokePvpReferee<RefereeJoinResponse>({
    action: 'join_game',
    gameId,
    sessionId,
    playerToken,
  });
}

function isPromotionMove(game: Chess, from: Square, to: Square): boolean {
  return game.moves({ square: from, verbose: true }).some((move) => {
    return move.to === to && Boolean(move.promotion);
  });
}

export function useOnlinePvp(gameId: string | undefined, onGameSwitch?: (gameId: string) => void) {
  const sessionIdRef = useRef(getPvpSessionId());
  const gameRef = useRef(new Chess());
  const gameDataRef = useRef<PvpGameRow | null>(null);
  const playerCredentialRef = useRef<PvpCredential | null>(getGameCredential(gameId));
  const [gameData, setGameData] = useState<PvpGameRow | null>(null);
  const [playerCredential, setPlayerCredential] = useState<PvpCredential | null>(() => getGameCredential(gameId));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fen, setFen] = useState(gameRef.current.fen());
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalMoves, setLegalMoves] = useState<Square[]>([]);
  const [capturedPieces, setCapturedPieces] = useState<CapturedPieces>({ w: [], b: [] });
  const [statusMessage, setStatusMessage] = useState('Waiting for opponent...');
  const [flavorText, setFlavorText] = useState('');
  const [movePending, setMovePending] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [lastMoveFeedback, setLastMoveFeedback] = useState<MoveFeedback | null>(null);
  const [invalidMoveFeedback, setInvalidMoveFeedback] = useState<InvalidMoveFeedback | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const [timeoutPending, setTimeoutPending] = useState(false);
  const [surrenderPending, setSurrenderPending] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<OnlineConnectionStatus>('connecting');
  const [connectionMessage, setConnectionMessage] = useState<string | null>('Connecting to referee...');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const invalidMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidMoveSequenceRef = useRef(0);
  const syncFailureCountRef = useRef(0);

  const sessionId = sessionIdRef.current;
  const playerColor = playerCredential?.color ?? null;

  const clearInvalidMoveTimer = useCallback(() => {
    if (invalidMoveTimerRef.current) {
      clearTimeout(invalidMoveTimerRef.current);
      invalidMoveTimerRef.current = null;
    }
  }, []);

  const clearInvalidMoveFeedback = useCallback(() => {
    clearInvalidMoveTimer();
    setInvalidMoveFeedback(null);
  }, [clearInvalidMoveTimer]);

  const showInvalidMoveFeedback = useCallback((square: Square, message: string) => {
    clearInvalidMoveTimer();
    invalidMoveSequenceRef.current += 1;
    setInvalidMoveFeedback(buildInvalidMoveFeedback(square, message, invalidMoveSequenceRef.current));
    setFlavorText(message);
    playIllegalMoveSound();
    invalidMoveTimerRef.current = setTimeout(() => {
      invalidMoveTimerRef.current = null;
      setInvalidMoveFeedback(null);
    }, 1200);
  }, [clearInvalidMoveTimer]);

  const markConnectionHealthy = useCallback(() => {
    syncFailureCountRef.current = 0;
    setConnectionStatus('online');
    setConnectionMessage(null);
    setLastSyncedAt(Date.now());
  }, []);

  const markConnectionIssue = useCallback((message: string) => {
    syncFailureCountRef.current += 1;
    setConnectionStatus(syncFailureCountRef.current >= 3 ? 'offline' : 'reconnecting');
    setConnectionMessage(message);
  }, []);

  const visibleClock = (() => {
    const row = gameData;
    const isWager = !!row?.payment_status;
    const isClocked = row?.white_clock_ms != null && row?.black_clock_ms != null;
    const whiteBase = numberFrom(row?.white_clock_ms, DEFAULT_WAGER_CLOCK_MS);
    const blackBase = numberFrom(row?.black_clock_ms, DEFAULT_WAGER_CLOCK_MS);
    let whiteMs = whiteBase;
    let blackMs = blackBase;

    if (
      isClocked &&
      row?.status === 'active' &&
      (!isWager || row.payment_status === 'both_deposited') &&
      (row.clock_turn === 'w' || row.clock_turn === 'b') &&
      row.clock_last_started_at
    ) {
      const elapsed = Math.max(0, clockNow - Date.parse(row.clock_last_started_at));
      if (row.clock_turn === 'w') whiteMs = Math.max(0, whiteBase - elapsed);
      if (row.clock_turn === 'b') blackMs = Math.max(0, blackBase - elapsed);
    }

    const expiredColor = whiteMs <= 0 ? 'w' : blackMs <= 0 ? 'b' : null;
    const canClaimTimeout = !!(
      isClocked &&
      row?.status === 'active' &&
      (!isWager || row.payment_status === 'both_deposited') &&
      playerColor &&
      expiredColor &&
      expiredColor !== playerColor &&
      !timeoutPending
    );

    return {
      isWager,
      isClocked,
      whiteMs,
      blackMs,
      whiteLabel: formatClock(whiteMs),
      blackLabel: formatClock(blackMs),
      activeColor: row?.clock_turn === 'w' || row?.clock_turn === 'b' ? row.clock_turn : null,
      expiredColor,
      canClaimTimeout,
      settlementStatus: row?.settlement_status ?? null,
    };
  })();

  const rebuildGame = useCallback((row: PvpGameRow) => {
    const moves = row.moves ?? [];
    const game = new Chess();
    let lastMove: Move | null = null;
    for (const san of moves) {
      try {
        lastMove = game.move(san);
      } catch {
        setSyncError('Game data is out of sync. Waiting for a clean update...');
        return;
      }
    }
    setSyncError(null);
    gameRef.current = game;
    setFen(game.fen());
    setLastMoveFeedback(lastMove ? buildMoveFeedback(game, lastMove) : null);

    // Update captured pieces
    const history = game.history({ verbose: true });
    const captured: CapturedPieces = { w: [], b: [] };
    for (const move of history) {
      if (move.captured) {
        const capturedColor = move.color === 'w' ? 'b' : 'w';
        captured[capturedColor].push(move.captured as PieceSymbol);
      }
    }
    setCapturedPieces(captured);

    // Status
    if (row.status === 'finished' && row.result_reason === 'resignation') {
      const resignedColor = row.winner === 'w' ? 'Black' : 'White';
      const winner = row.winner === 'w' ? 'White' : row.winner === 'b' ? 'Black' : 'Opponent';
      setStatusMessage(`${resignedColor.toUpperCase()} SURRENDERED! ${winner.toUpperCase()} WINS!`);
      setFlavorText('The match ended by surrender.');
    } else if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 'Black' : 'White';
      setStatusMessage(`CHECKMATE! ${winner} wins!`);
      setFlavorText('The king has fallen!');
    } else if (game.isDraw()) {
      setStatusMessage('DRAW!');
      setFlavorText('Neither side prevails...');
    } else if (game.isCheck()) {
      setStatusMessage(`CHECK! ${game.turn() === 'w' ? "White's" : "Black's"} turn`);
      setFlavorText('The king is in danger!');
    } else {
      setStatusMessage(`${game.turn() === 'w' ? "White's" : "Black's"} turn`);
      setFlavorText('');
    }
  }, []);

  // Play sound for the last move
  const playSoundForLastMove = useCallback((moves: string[], prevLength: number) => {
    if (moves.length <= prevLength) return;
    const game = new Chess();
    let lastResult: Move | null = null;
    for (const san of moves) {
      try {
        lastResult = game.move(san);
      } catch {
        return;
      }
    }
    if (!lastResult) return;
    if (game.isCheckmate() || game.isDraw()) {
      playGameOverSound();
    } else if (game.isCheck()) {
      playCheckSound();
    } else if (lastResult.captured) {
      playCaptureSound();
    } else {
      playMoveSound();
    }
  }, []);

  const applyGameRow = useCallback((row: PvpGameRow, playSound = false) => {
    const prevMoveCount = gameDataRef.current?.moves?.length || 0;
    const wasActive = gameDataRef.current?.status === 'active';
    gameDataRef.current = row;
    setGameData(row);
    clearInvalidMoveFeedback();
    rebuildGame(row);
    markConnectionHealthy();
    if (playSound) playSoundForLastMove(row.moves || [], prevMoveCount);
    if (playSound && wasActive && row.status === 'finished' && row.result_reason === 'resignation') {
      playGameOverSound();
    }
  }, [clearInvalidMoveFeedback, markConnectionHealthy, rebuildGame, playSoundForLastMove]);

  const applyJoinResponse = useCallback((response: RefereeJoinResponse, playSound = false) => {
    const credential = saveGameCredential(response);
    if (gameId && gameId !== response.gameId) removeGameCredential(gameId);
    playerCredentialRef.current = credential;
    setPlayerCredential(credential);
    applyGameRow(response.game, playSound);
    if (gameId !== response.gameId) onGameSwitch?.(response.gameId);
  }, [applyGameRow, gameId, onGameSwitch]);

  const refreshGame = useCallback(async (playSound = false) => {
    const credential = playerCredentialRef.current;
    if (!gameId || !credential) return;
    const response = await invokePvpReferee<RefereeGameResponse>({
      action: 'get_game',
      gameId,
      playerToken: credential.playerToken,
    });
    applyGameRow(response.game, playSound);
  }, [applyGameRow, gameId]);

  const retrySync = useCallback(async () => {
    if (!gameId || !playerCredentialRef.current) {
      markConnectionIssue('Missing local match credential. Reopen the match link.');
      return;
    }

    setConnectionStatus('connecting');
    setConnectionMessage('Syncing with referee...');
    try {
      await refreshGame(true);
    } catch {
      markConnectionIssue('Manual sync failed. Retrying...');
    }
  }, [gameId, markConnectionIssue, refreshGame]);

  useEffect(() => {
    const stored = getGameCredential(gameId);
    playerCredentialRef.current = stored;
    setPlayerCredential(stored);
  }, [gameId]);

  // Fetch game & join if needed
  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;

    const setCredential = (credential: PvpCredential | null) => {
      playerCredentialRef.current = credential;
      setPlayerCredential(credential);
    };

    const fetchAndJoin = async () => {
      try {
        const session = await ensurePvpSession();
        sessionIdRef.current = session.sessionId;
        const myBaseId = session.sessionId;
        let credential = getGameCredential(gameId);
        let row: PvpGameRow | null = null;

        if (credential) {
          try {
            const verified = await joinExistingGame(gameId, myBaseId, credential.playerToken);
            credential = saveGameCredential(verified);
            row = verified.game;
          } catch {
            removeGameCredential(gameId);
            credential = null;
          }
        }

        if (!credential) {
          const joined = await joinExistingGame(gameId, myBaseId);
          credential = saveGameCredential(joined);
          row = joined.game;
        }

        if (!credential || !row) {
          if (!cancelled) {
            setConnectionStatus('offline');
            setConnectionMessage('Unable to verify this match.');
            setError('Game is full or this browser is not a player.');
          }
          setLoading(false);
          return;
        }

        if (!cancelled) {
          setCredential(credential);
          applyGameRow(row);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to join online game';
          setConnectionStatus('offline');
          setConnectionMessage(message);
          setError(message);
          setLoading(false);
        }
      }
    };

    fetchAndJoin();
    return () => { cancelled = true; };
  }, [gameId, applyGameRow]);

  // Keep refs in sync
  useEffect(() => {
    gameDataRef.current = gameData;
  }, [gameData]);

  useEffect(() => {
    playerCredentialRef.current = playerCredential;
  }, [playerCredential]);

  useEffect(() => {
    if (
      gameData?.status !== 'active' ||
      gameData.payment_status !== 'both_deposited' ||
      !(gameData.clock_turn === 'w' || gameData.clock_turn === 'b')
    ) {
      return;
    }

    setClockNow(Date.now());
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [gameData?.status, gameData?.payment_status, gameData?.clock_turn, gameData?.clock_last_started_at]);

  // Poll safe referee read model instead of subscribing to full pvp_games rows.
  useEffect(() => {
    if (!gameId || !playerCredential) return;

    const interval = window.setInterval(() => {
      refreshGame(true).catch(() => {
        markConnectionIssue('Could not reach referee. Retrying...');
      });
    }, 1500);

    return () => window.clearInterval(interval);
  }, [gameId, markConnectionIssue, playerCredential, refreshGame]);

  useEffect(() => {
    return clearInvalidMoveTimer;
  }, [clearInvalidMoveTimer]);

  const isMyTurn = !!playerColor &&
    playerColor === gameRef.current.turn() &&
    gameData?.status === 'active' &&
    !movePending &&
    !surrenderPending;
  const opponentJoined = !!gameData?.black_player_present;
  const isWaitingHost = playerColor === 'w' && !opponentJoined && gameData?.status === 'waiting';
  const game = gameRef.current;

  useEffect(() => {
    if (!gameId || !isWaitingHost) return;

    const heartbeat = () => {
      const credential = playerCredentialRef.current;
      if (!credential) return;

      invokePvpReferee<RefereeHeartbeatResponse>({
        action: 'heartbeat',
        gameId,
        sessionId,
        playerToken: credential.playerToken,
      }).then((response) => {
        if (response.gameId && response.color && response.playerToken) {
          applyJoinResponse({
            gameId: response.gameId,
            color: response.color,
            playerToken: response.playerToken,
            game: response.game,
          });
          return;
        }
        if (response.game) applyGameRow(response.game);
      }).catch(() => {
        // Stale tabs age out naturally; the visible cancel button remains available.
      });
    };

    heartbeat();
    const interval = window.setInterval(heartbeat, 30_000);
    return () => window.clearInterval(interval);
  }, [applyGameRow, applyJoinResponse, gameId, isWaitingHost, sessionId]);

  const cancelWaitingMatch = useCallback(async (wallet?: WalletActionContext) => {
    const credential = playerCredentialRef.current;
    const row = gameDataRef.current;
    if (!gameId || !isWaitingHost || !credential || !row) return;

    if (row.payment_status && isRobinhoodWager(row)) {
      const terms = wagerTerms(row);
      const robinhoodWallet = await requireRobinhoodWallet(wallet);
      const response = await cancelRobinhoodWager({
        gameId,
        sessionId,
        playerToken: credential.playerToken,
        contestId: terms.escrowContestId,
        escrowAddress: row.robinhood_escrow_address,
        stakeWei: terms.stakeLamports,
        assetMint: terms.assetMint,
        wallet: robinhoodWallet,
      });
      if (response.game) applyGameRow(response.game as PvpGameRow);
    } else if (row.payment_status && isSponsoredWager(row)) {
      const terms = wagerTerms(row);
      const walletPublicKey = await requireWallet(wallet);
      const walletAddress = walletPublicKey.toBase58();
      const walletProof = await signWalletProof({
        action: 'cancel_sponsored_wager',
        sessionId,
        gameId,
        walletAddress,
        signMessage: requireWalletMessageSigner(wallet),
      });
      const response = await cancelSponsoredWager({
        gameId,
        sessionId,
        playerToken: credential.playerToken,
        walletAddress,
        stakeLamports: terms.stakeLamports,
        escrowContestId: terms.escrowContestId,
        ...walletProof,
      });
      if (response.game) applyGameRow(response.game as PvpGameRow);
    } else if (row.payment_status && row.payment_status !== 'white_prepared') {
      const terms = wagerTerms(row);
      const escrow = resolveBrowserEscrowFactory();
      if (!escrow) throw new Error('Escrow instructions are not configured.');
      const walletPublicKey = await requireWallet(wallet);
      const walletAddress = walletPublicKey.toBase58();
      const response = await buildSignedCancelRequest({
        gameId,
        sessionId,
        playerToken: credential.playerToken,
        walletPublicKey,
        walletAddress,
        assetMint: terms.assetMint,
        tokenProgramId: terms.tokenProgramId,
        stakeLamports: terms.stakeLamports,
        escrowContestId: terms.escrowContestId,
        escrow,
        signAndSendTransaction: wallet!.signAndSendTransaction!,
        signMessage: requireWalletMessageSigner(wallet),
      });
      if (response.game) applyGameRow(response.game as PvpGameRow);
    } else if (row.payment_status) {
      const terms = wagerTerms(row);
      const walletAddress = row.white_wallet_address ?? '';
      await requireWallet(wallet);
      const walletProof = await signWalletProof({
        action: 'cancel_wager_waiting',
        sessionId,
        gameId,
        walletAddress,
        signMessage: requireWalletMessageSigner(wallet),
      });
      const response = await cancelWagerWaiting({
        gameId,
        sessionId,
        playerToken: credential.playerToken,
        walletAddress,
        assetMint: terms.assetMint,
        stakeLamports: terms.stakeLamports,
        escrowContestId: terms.escrowContestId,
        ...walletProof,
      });
      if (response.game) applyGameRow(response.game as PvpGameRow);
    } else {
      await cancelWaitingGame(gameId, sessionId, credential.playerToken);
    }
    removeGameCredential(gameId);
  }, [applyGameRow, gameId, isWaitingHost, sessionId]);

  const retryWagerSettlement = useCallback(async () => {
    const credential = playerCredentialRef.current;
    if (!gameId || !credential) throw new Error('Referee token missing. Rejoin the match.');
    await settleFinishedWager({ gameId, playerToken: credential.playerToken });
  }, [gameId]);

  const refundWager = useCallback(async (wallet?: WalletActionContext) => {
    const credential = playerCredentialRef.current;
    const row = gameDataRef.current;
    if (!gameId || !credential || !row) throw new Error('Referee token missing. Rejoin the match.');
    const terms = wagerTerms(row);
    if (isRobinhoodWager(row)) {
      const response = await refundExpiredRobinhoodWager({
        gameId,
        sessionId,
        playerToken: credential.playerToken,
        contestId: terms.escrowContestId,
        escrowAddress: row.robinhood_escrow_address,
        stakeWei: terms.stakeLamports,
        assetMint: terms.assetMint,
        wallet: await requireRobinhoodWallet(wallet),
      });
      if (response.game) applyGameRow(response.game as PvpGameRow);
      return;
    }
    if (isSponsoredWager(row)) {
      throw new Error('Sponsored refunds are handled automatically. Settlement will retry, refund, or mark support needed.');
    }
    const escrow = resolveBrowserEscrowFactory();
    if (!escrow) throw new Error('Escrow instructions are not configured.');
    const walletPublicKey = await requireWallet(wallet);
    const walletAddress = walletPublicKey.toBase58();
    if (!row.white_wallet_address || !row.black_wallet_address) {
      throw new Error('Both player wallets are required for an escrow refund.');
    }
    const response = await buildSignedRefundRequest({
      gameId,
      sessionId,
      playerToken: credential.playerToken,
      walletPublicKey,
      walletAddress,
      whiteWalletAddress: row.white_wallet_address,
      blackWalletAddress: row.black_wallet_address,
      assetMint: terms.assetMint,
      tokenProgramId: terms.tokenProgramId,
      stakeLamports: terms.stakeLamports,
      escrowContestId: terms.escrowContestId,
      escrow,
      signAndSendTransaction: wallet!.signAndSendTransaction!,
      signMessage: requireWalletMessageSigner(wallet),
    });
    if (response.game) applyGameRow(response.game as PvpGameRow);
  }, [applyGameRow, gameId, sessionId]);

  const claimWagerPrize = useCallback(async (wallet?: WalletActionContext) => {
    const credential = playerCredentialRef.current;
    const row = gameDataRef.current;
    if (!gameId || !credential || !row) throw new Error('Referee token missing. Rejoin the match.');
    if (!isRobinhoodWager(row)) throw new Error('This prize is not on Robinhood Chain.');
    const terms = wagerTerms(row);
    const robinhoodWallet = await requireRobinhoodWallet(wallet);
    return claimRobinhoodEth(terms.escrowContestId, robinhoodWallet, row.robinhood_escrow_address);
  }, [gameId]);

  const prepareWagerPrizeRblxSwap = useCallback(async (claimTransactionHash: Hash, wallet?: WalletActionContext) => {
    const credential = playerCredentialRef.current;
    const row = gameDataRef.current;
    if (!gameId || !credential || !row) throw new Error('Referee token missing. Rejoin the match.');
    if (!isRobinhoodWager(row)) throw new Error('This prize is not on Robinhood Chain.');
    return getRobinhoodRblxQuote({
      gameId, playerToken: credential.playerToken, claimTransactionHash,
      expectedPrizeWei: BigInt(row.wager_stake_raw || "0") * 2n,
      wallet: await requireRobinhoodWallet(wallet),
    });
  }, [gameId]);

  const convertWagerPrizeToRblx = useCallback(async (claimTransactionHash: Hash, quote: RblxSwapQuote, wallet?: WalletActionContext) => {
    const row = gameDataRef.current;
    if (!gameId || !row || !isRobinhoodWager(row)) throw new Error('Robinhood prize missing. Rejoin the match.');
    return (await swapRobinhoodPrizeForRblx({
      gameId, claimTransactionHash, quote,
      expectedPrizeWei: BigInt(row.wager_stake_raw || "0") * 2n,
      wallet: await requireRobinhoodWallet(wallet),
    })).hash;
  }, [gameId]);

  const claimTimeout = useCallback(async (wallet?: WalletActionContext) => {
    const credential = playerCredentialRef.current;
    const row = gameDataRef.current;
    if (!gameId || !credential || !row || timeoutPending) return;
    const isWager = !!row.payment_status;

    const walletAddress = credential.color === 'w'
      ? row.white_wallet_address
      : row.black_wallet_address;
    if (isWager && !walletAddress) {
      setFlavorText('Wallet address missing for timeout claim.');
      return;
    }

    setTimeoutPending(true);
    try {
      const walletProof = isWager && walletAddress
        ? await signWalletProof({
          action: 'claim_timeout',
          sessionId,
          gameId,
          walletAddress,
          signMessage: requireWalletMessageSigner(wallet),
        })
        : {};
      const response = await invokePvpReferee<RefereeGameResponse>({
        action: 'claim_timeout',
        gameId,
        sessionId,
        playerToken: credential.playerToken,
        walletAddress: walletAddress ?? undefined,
        ...walletProof,
      });
      applyGameRow(response.game, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Timeout claim rejected by referee';
      setFlavorText(message);
    } finally {
      setTimeoutPending(false);
    }
  }, [applyGameRow, gameId, sessionId, timeoutPending]);

  const surrenderMatch = useCallback(async () => {
    const credential = playerCredentialRef.current;
    const row = gameDataRef.current;
    if (!gameId || !credential || !row || surrenderPending) return;
    if (row.status !== 'active' || !row.black_player_present) {
      setFlavorText('Surrender is available once the match is active.');
      return;
    }

    setSelectedSquare(null);
    setLegalMoves([]);
    setPendingPromotion(null);
    clearInvalidMoveFeedback();
    setSurrenderPending(true);
    try {
      const response = await invokePvpReferee<RefereeGameResponse>({
        action: 'resign',
        gameId,
        sessionId,
        playerToken: credential.playerToken,
        expectedPly: row.moves?.length ?? 0,
      });
      applyGameRow(response.game, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Surrender rejected by referee';
      setFlavorText(message);
    } finally {
      setSurrenderPending(false);
    }
  }, [applyGameRow, clearInvalidMoveFeedback, gameId, sessionId, surrenderPending]);

  const submitMove = useCallback(async (from: Square, to: Square, promotion: PromotionPiece = 'q') => {
    const credential = playerCredentialRef.current;
    if (!credential || !gameId) {
      const message = 'Referee token missing. Rejoin the match.';
      setMoveError(message);
      setFlavorText(message);
      return;
    }

    setPendingPromotion(null);
    setSelectedSquare(null);
    setLegalMoves([]);
    clearInvalidMoveFeedback();
    setMovePending(true);
    setMoveError(null);

    try {
      const response = await invokePvpReferee<RefereeGameResponse>({
        action: 'move',
        gameId,
        sessionId,
        playerToken: credential.playerToken,
        from,
        to,
        promotion,
        expectedPly: gameDataRef.current?.moves?.length ?? 0,
        requestId: crypto.randomUUID(),
      });
      applyGameRow(response.game, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Move rejected by referee';
      setMoveError(message);
      setFlavorText(message);
      const latestRow = gameDataRef.current;
      if (latestRow) rebuildGame(latestRow);
    } finally {
      setMovePending(false);
    }
  }, [applyGameRow, clearInvalidMoveFeedback, gameId, rebuildGame, sessionId]);

  const handleSquareClick = useCallback(async (square: Square) => {
    if (movePending || surrenderPending || syncError || pendingPromotion || game.isGameOver() || gameDataRef.current?.status === 'finished') return;
    if (!opponentJoined) {
      showInvalidMoveFeedback(square, 'WAITING FOR OPPONENT');
      return;
    }
    if (!isMyTurn) {
      showInvalidMoveFeedback(square, 'WAIT YOUR TURN');
      return;
    }

    const piece = game.get(square);

    if (selectedSquare) {
      if (legalMoves.includes(square)) {
        if (isPromotionMove(game, selectedSquare, square)) {
          clearInvalidMoveFeedback();
          setPendingPromotion({ from: selectedSquare, to: square, color: game.turn() as 'w' | 'b' });
          setSelectedSquare(null);
          setLegalMoves([]);
          return;
        }

        await submitMove(selectedSquare, square);
        return;
      }

      if (piece && piece.color === playerColor) {
        clearInvalidMoveFeedback();
        setSelectedSquare(square);
        const moves = game.moves({ square, verbose: true });
        setLegalMoves(moves.map(m => m.to as Square));
        return;
      }

      showInvalidMoveFeedback(square, 'THAT PIECE CANNOT MOVE THERE');
      return;
    }

    if (piece && piece.color === playerColor) {
      clearInvalidMoveFeedback();
      setSelectedSquare(square);
      const moves = game.moves({ square, verbose: true });
      setLegalMoves(moves.map(m => m.to as Square));
      return;
    }

    showInvalidMoveFeedback(square, piece ? 'SELECT YOUR OWN PIECE' : 'SELECT A PIECE FIRST');
  }, [
    clearInvalidMoveFeedback,
    game,
    selectedSquare,
    legalMoves,
    isMyTurn,
    opponentJoined,
    pendingPromotion,
    playerColor,
    movePending,
    surrenderPending,
    showInvalidMoveFeedback,
    submitMove,
    syncError,
  ]);

  const handlePieceDrop = useCallback(async (from: Square, to: Square) => {
    if (movePending || surrenderPending || syncError || pendingPromotion || game.isGameOver() || gameDataRef.current?.status === 'finished') return;
    if (!opponentJoined) {
      showInvalidMoveFeedback(to, 'WAITING FOR OPPONENT');
      return;
    }
    if (!isMyTurn) {
      showInvalidMoveFeedback(to, 'WAIT YOUR TURN');
      return;
    }

    const piece = game.get(from);
    if (!piece) {
      showInvalidMoveFeedback(from, 'SELECT A PIECE FIRST');
      return;
    }

    if (piece.color !== playerColor) {
      showInvalidMoveFeedback(from, 'SELECT YOUR OWN PIECE');
      return;
    }

    const moves = game.moves({ square: from, verbose: true });
    const destinations = moves.map(move => move.to as Square);
    setSelectedSquare(from);
    setLegalMoves(destinations);

    if (to === from) {
      clearInvalidMoveFeedback();
      return;
    }

    if (!destinations.includes(to)) {
      showInvalidMoveFeedback(to, 'THAT PIECE CANNOT MOVE THERE');
      return;
    }

    if (isPromotionMove(game, from, to)) {
      clearInvalidMoveFeedback();
      setPendingPromotion({ from, to, color: game.turn() as 'w' | 'b' });
      setSelectedSquare(null);
      setLegalMoves([]);
      return;
    }

    await submitMove(from, to);
  }, [
    clearInvalidMoveFeedback,
    game,
    isMyTurn,
    movePending,
    opponentJoined,
    pendingPromotion,
    playerColor,
    showInvalidMoveFeedback,
    submitMove,
    surrenderPending,
    syncError,
  ]);

  const choosePromotion = useCallback(async (piece: PromotionPiece) => {
    if (!pendingPromotion || movePending) return;
    await submitMove(pendingPromotion.from, pendingPromotion.to, piece);
  }, [movePending, pendingPromotion, submitMove]);

  const cancelPromotion = useCallback(() => {
    if (movePending) return;
    clearInvalidMoveFeedback();
    setPendingPromotion(null);
  }, [clearInvalidMoveFeedback, movePending]);

  return {
    loading,
    error,
    fen,
    board: game.board(),
    selectedSquare,
    legalMoves,
    highlightedSquares: lastMoveFeedback ? [lastMoveFeedback.from, lastMoveFeedback.to] : [],
    pendingPromotion,
    lastMoveFeedback,
    invalidMoveFeedback,
    currentTurn: game.turn() as PlayerColor,
    isCheck: game.isCheck(),
    isCheckmate: game.isCheckmate(),
    isDraw: game.isDraw(),
    isGameOver: game.isGameOver() || gameData?.status === 'finished',
    capturedPieces,
    statusMessage,
    flavorText,
    movePending,
    moveError,
    syncError,
    connectionStatus,
    connectionMessage,
    lastSyncedAt,
    handleSquareClick,
    handlePieceDrop,
    choosePromotion,
    cancelPromotion,
    surrenderMatch,
    retrySync,
    history: game.history(),
    moveHistory: game.history({ verbose: true }).map((move) => ({
      san: move.san,
      from: move.from,
      to: move.to,
      piece: move.piece,
      captured: move.captured,
      promotion: move.promotion,
      isCapture: move.isCapture(),
      isCheck: move.san.includes('+'),
      isCheckmate: move.san.includes('#'),
      isKingsideCastle: move.isKingsideCastle(),
      isQueensideCastle: move.isQueensideCastle(),
    })),
    gameInstance: game,
    playerColor,
    isMyTurn,
    opponentJoined,
    winner: gameData?.winner,
    cancelWaitingMatch,
    retryWagerSettlement,
    refundWager,
    claimWagerPrize,
    convertWagerPrizeToRblx,
    prepareWagerPrizeRblxSwap,
    claimTimeout,
    wagerClock: visibleClock,
    wagerSettlement: deriveWagerSettlementSummary(
      gameData,
      game.isCheckmate() ? 'checkmate' : game.isDraw() ? 'draw' : 'finished'
    ),
    gameData,
    timeoutPending,
    surrenderPending,
    sessionId,
    gameId: gameData?.id,
  };
}

export async function joinPvpQueue(timeControl?: string): Promise<string> {
  const session = await ensurePvpSession();
  const sessionId = session.sessionId;
  const existingCredential = reusableWaitingCredential();

  const response = await invokePvpReferee<RefereeJoinResponse>({
    action: 'join_queue',
    sessionId,
    reuseGameId: existingCredential?.gameId,
    playerToken: existingCredential?.playerToken,
    timeControl,
  });

  saveGameCredential(response);
  return response.gameId;
}

export async function listPvpLobbyDirectory(): Promise<{
  lobbies: PvpLobby[];
  queueCounts: PvpQueueCount[];
}> {
  const response = await invokePvpReferee<RefereeLobbyListResponse>({
    action: 'list_lobbies',
  });
  return {
    lobbies: Array.isArray(response.lobbies) ? response.lobbies : [],
    queueCounts: Array.isArray(response.queueCounts) ? response.queueCounts : [],
  };
}

export async function listPvpLobbies(): Promise<PvpLobby[]> {
  return (await listPvpLobbyDirectory()).lobbies;
}

export async function createPvpLobby(input: CreatePvpLobbyInput): Promise<{
  gameId: string;
  lobby: PvpLobby;
}> {
  const existingCredential = input.gameId ? getGameCredential(input.gameId) : null;
  const response = await invokePvpReferee<RefereeLobbyJoinResponse>({
    action: 'create_lobby',
    gameId: input.gameId,
    playerToken: existingCredential?.playerToken,
    lobbyName: input.name,
    hostName: input.hostName,
    matchType: input.matchType,
    access: input.access,
    preferredColor: input.color,
    timeControl: input.timeControl,
    stakeRaw: input.stakeRaw,
    stakeLabel: input.stakeLabel,
    assetSymbol: input.assetSymbol,
  });

  if (response.gameId && response.color && response.playerToken && response.game) {
    saveGameCredential(response as RefereeJoinResponse);
  }

  return {
    gameId: response.gameId,
    lobby: response.lobby,
  };
}

export async function joinPvpLobby(lobbyId: string): Promise<{
  gameId: string;
  lobby: PvpLobby;
  requiresWager: boolean;
}> {
  const response = await invokePvpReferee<RefereeLobbyJoinResponse>({
    action: 'join_lobby',
    lobbyId,
  });

  if (response.gameId && response.color && response.playerToken && response.game) {
    saveGameCredential(response as RefereeJoinResponse);
  }

  return {
    gameId: response.gameId,
    lobby: response.lobby,
    requiresWager: response.requiresWager === true,
  };
}

export async function joinWagerPvpQueue(
  args: Omit<EnterWagerQueueArgs, 'sessionId'>
): Promise<string> {
  const session = await ensurePvpSession();
  const response = await enterWagerQueue({
    ...args,
    sessionId: session.sessionId,
  });

  saveGameCredential({
    gameId: response.gameId,
    color: response.color,
    playerToken: response.playerToken,
    game: {
      id: response.gameId,
      white_player_present: response.color === 'w',
      black_player_present: response.color === 'b',
      moves: [],
      status: response.color === 'w' ? 'waiting' : 'active',
      winner: null,
      created_at: null,
      updated_at: null,
    },
  });

  return response.gameId;
}

export function saveRobinhoodWagerCredential(response: { gameId: string; color: 'w' | 'b'; playerToken: string }) {
  saveGameCredential({
    gameId: response.gameId,
    color: response.color,
    playerToken: response.playerToken,
    game: {
      id: response.gameId,
      white_player_present: response.color === 'w',
      black_player_present: response.color === 'b',
      moves: [],
      status: response.color === 'w' ? 'waiting' : 'active',
      winner: null,
      created_at: null,
      updated_at: null,
    },
  });
}

export async function joinRobinhoodWagerPvpQueue(
  args: Omit<EnterRobinhoodWagerArgs, 'sessionId'>,
): Promise<string> {
  const session = await ensurePvpSession();
  const response = await enterRobinhoodWagerQueue({ ...args, sessionId: session.sessionId, onPrepared: saveRobinhoodWagerCredential });
  saveRobinhoodWagerCredential(response);
  clearPendingRobinhoodWager(response.escrowAddress ?? robinhoodEscrowAddress()!, args.address, response.gameId);
  return response.gameId;
}

export async function hostRobinhoodWagerPvpLobby(
  args: Omit<EnterRobinhoodWagerArgs, 'sessionId'>,
): Promise<string> {
  const session = await ensurePvpSession();
  const response = await hostRobinhoodWagerLobby({ ...args, sessionId: session.sessionId, onPrepared: saveRobinhoodWagerCredential });
  saveRobinhoodWagerCredential(response);
  clearPendingRobinhoodWager(response.escrowAddress ?? robinhoodEscrowAddress()!, args.address, response.gameId);
  return response.gameId;
}

export async function joinRobinhoodWagerPvpLobby(
  gameId: string,
  args: Omit<EnterRobinhoodWagerArgs, 'sessionId'>,
): Promise<string> {
  const session = await ensurePvpSession();
  const response = await joinRobinhoodWagerLobby(gameId, { ...args, sessionId: session.sessionId, onPrepared: saveRobinhoodWagerCredential });
  saveRobinhoodWagerCredential(response);
  clearPendingRobinhoodWager(response.escrowAddress ?? robinhoodEscrowAddress()!, args.address, response.gameId);
  return response.gameId;
}

export async function hostWagerPvpLobby(
  args: Omit<EnterWagerQueueArgs, 'sessionId'>
): Promise<string> {
  const session = await ensurePvpSession();
  const response = await enterWagerLobbyHost({
    ...args,
    sessionId: session.sessionId,
  });

  saveGameCredential({
    gameId: response.gameId,
    color: response.color,
    playerToken: response.playerToken,
    game: {
      id: response.gameId,
      white_player_present: true,
      black_player_present: false,
      moves: [],
      status: 'waiting',
      winner: null,
      created_at: null,
      updated_at: null,
    },
  });

  return response.gameId;
}

export async function joinWagerPvpLobby(
  gameId: string,
  args: Omit<EnterWagerQueueArgs, 'sessionId'>
): Promise<string> {
  const session = await ensurePvpSession();
  const response = await enterWagerLobby({
    ...args,
    gameId,
    sessionId: session.sessionId,
  });

  saveGameCredential({
    gameId: response.gameId,
    color: response.color,
    playerToken: response.playerToken,
    game: {
      id: response.gameId,
      white_player_present: true,
      black_player_present: true,
      moves: [],
      status: 'active',
      winner: null,
      created_at: null,
      updated_at: null,
    },
  });

  return response.gameId;
}

export async function cancelWaitingGame(
  gameId: string,
  sessionId = getPvpSessionId(),
  playerToken = getGameCredential(gameId)?.playerToken
): Promise<void> {
  if (!playerToken) return;

  await invokePvpReferee<RefereeGameResponse>({
    action: 'cancel_waiting',
    gameId,
    sessionId,
    playerToken,
  });
}
