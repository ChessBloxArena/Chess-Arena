import { CAPTURE_DURATION } from '@/lib/captureMotion';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Chess, Square, PieceSymbol } from 'chess.js';
import { getBestMove } from '@/lib/chessCPU';
import { playMoveSound, playCaptureSound, playCheckSound, playGameOverSound, playIllegalMoveSound } from '@/lib/sounds';
import { buildMoveFeedback, type MoveFeedback } from '@/lib/moveFeedback';
import { buildInvalidMoveFeedback, type InvalidMoveFeedback } from '@/lib/invalidMoveFeedback';
import type { PromotionPiece } from '@/components/PromotionPicker';

export type GameMode = 'pvp' | 'cpu';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface CapturedPieces {
  w: PieceSymbol[];
  b: PieceSymbol[];
}

export interface PendingPromotion {
  from: Square;
  to: Square;
  color: 'w' | 'b';
}

interface DrawMessage {
  status: string;
  flavor: string;
  reason: string;
}

const FLAVOR_TEXTS = [
  "Your move, warrior...",
  "The board awaits...",
  "Choose wisely...",
  "A bold strategy...",
  "The pieces tremble...",
  "Destiny calls...",
  "Think carefully...",
  "The clock ticks...",
];

function randomFlavor(): string {
  return FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];
}

function randomCpuDelay(): number {
  return 1180 + Math.random() * 220;
}

function getDrawMessage(game: Chess): DrawMessage | null {
  if (game.isStalemate()) {
    return {
      status: "DRAW BY STALEMATE!",
      flavor: "The king is trapped, but not conquered.",
      reason: "STALEMATE: NO LEGAL MOVES",
    };
  }

  if (game.isInsufficientMaterial()) {
    return {
      status: "DRAW BY INSUFFICIENT MATERIAL!",
      flavor: "No army remains strong enough to finish the fight.",
      reason: "INSUFFICIENT MATERIAL",
    };
  }

  if (game.isThreefoldRepetition()) {
    return {
      status: "DRAW BY REPETITION!",
      flavor: "The same battlefield returns again and again.",
      reason: "THREEFOLD REPETITION",
    };
  }

  if (game.isDrawByFiftyMoves()) {
    return {
      status: "DRAW BY FIFTY-MOVE RULE!",
      flavor: "Fifty moves pass without capture or pawn advance.",
      reason: "FIFTY-MOVE RULE",
    };
  }

  if (game.isDraw()) {
    return {
      status: "DRAW!",
      flavor: "Neither side prevails...",
      reason: "DRAW",
    };
  }

  return null;
}

function isPromotionMove(game: Chess, from: Square, to: Square): boolean {
  return game.moves({ square: from, verbose: true }).some((move) => {
    return move.to === to && Boolean(move.promotion);
  });
}

export function useChessGame(mode: GameMode, difficulty: Difficulty) {
  const gameRef = useRef(new Chess());
  const [fen, setFen] = useState(gameRef.current.fen());
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalMoves, setLegalMoves] = useState<Square[]>([]);
  const [capturedPieces, setCapturedPieces] = useState<CapturedPieces>({ w: [], b: [] });
  const [statusMessage, setStatusMessage] = useState("The battle begins...");
  const [flavorText, setFlavorText] = useState("");
  const [cpuThinking, setCpuThinking] = useState(false);
  const [resignedBy, setResignedBy] = useState<'w' | 'b' | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [lastMoveFeedback, setLastMoveFeedback] = useState<MoveFeedback | null>(null);
  const [invalidMoveFeedback, setInvalidMoveFeedback] = useState<InvalidMoveFeedback | null>(null);
  const cpuMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidMoveSequenceRef = useRef(0);

  const game = gameRef.current;

  const clearCpuMoveTimer = useCallback(() => {
    if (cpuMoveTimerRef.current) {
      clearTimeout(cpuMoveTimerRef.current);
      cpuMoveTimerRef.current = null;
    }
  }, []);

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

  const updateCaptured = useCallback(() => {
    const history = game.history({ verbose: true });
    const captured: CapturedPieces = { w: [], b: [] };
    for (const move of history) {
      if (move.captured) {
        const capturedColor = move.color === 'w' ? 'b' : 'w';
        captured[capturedColor].push(move.captured as PieceSymbol);
      }
    }
    setCapturedPieces(captured);
  }, [game]);

  const updateStatus = useCallback(() => {
    setFen(game.fen());
    updateCaptured();

    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 'Black' : 'White';
      setStatusMessage(`CHECKMATE! ${winner} wins!`);
      setFlavorText("The king has fallen!");
      playGameOverSound();
    } else if (game.isDraw()) {
      const drawMessage = getDrawMessage(game);
      setStatusMessage(drawMessage?.status ?? "DRAW!");
      setFlavorText(drawMessage?.flavor ?? "Neither side prevails...");
      playGameOverSound();
    } else if (game.isCheck()) {
      setStatusMessage(`CHECK! ${game.turn() === 'w' ? "White's" : "Black's"} turn`);
      setFlavorText("The king is in danger!");
      playCheckSound();
    } else {
      setStatusMessage(`${game.turn() === 'w' ? "White's" : "Black's"} turn`);
      setFlavorText(randomFlavor());
    }
  }, [game, updateCaptured]);

  const makeCpuMove = useCallback(() => {
    if (mode !== 'cpu' || game.turn() !== 'b' || game.isGameOver() || resignedBy) {
      setCpuThinking(false);
      return;
    }

    const move = getBestMove(game, difficulty);
    if (move) {
      const result = game.move(move);
      if (result) {
        setLastMoveFeedback(buildMoveFeedback(game, result));
        if (result.captured) {
          playCaptureSound();
        } else {
          playMoveSound();
        }
      }
      updateStatus();
    }
    setCpuThinking(false);
  }, [difficulty, game, mode, resignedBy, updateStatus]);

  const scheduleCpuMove = useCallback(() => {
    if (mode !== 'cpu' || game.turn() !== 'b' || game.isGameOver() || resignedBy) {
      setCpuThinking(false);
      return;
    }

    if (cpuMoveTimerRef.current) return;

    setCpuThinking(true);
    cpuMoveTimerRef.current = setTimeout(() => {
      cpuMoveTimerRef.current = null;
      makeCpuMove();
    }, game.history({ verbose: true }).at(-1)?.captured ? CAPTURE_DURATION * 1000 + 100 : randomCpuDelay());
  }, [game, makeCpuMove, mode, resignedBy]);

  const makePlayerMove = useCallback((from: Square, to: Square, promotion: PromotionPiece = 'q') => {
    const moveResult = game.move({ from, to, promotion });
    if (moveResult) {
      clearInvalidMoveFeedback();
      setLastMoveFeedback(buildMoveFeedback(game, moveResult));
      if (moveResult.captured) {
        playCaptureSound();
      } else {
        playMoveSound();
      }
    }
    setPendingPromotion(null);
    setSelectedSquare(null);
    setLegalMoves([]);
    updateStatus();
    scheduleCpuMove();
  }, [clearInvalidMoveFeedback, game, scheduleCpuMove, updateStatus]);

  const handleSquareClick = useCallback((square: Square) => {
    if (pendingPromotion) return;
    if (resignedBy) return;
    if (game.isGameOver()) return;
    if (mode === 'cpu' && game.turn() === 'b') {
      showInvalidMoveFeedback(square, 'CPU THINKING');
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
        makePlayerMove(selectedSquare, square);
        return;
      }

      if (piece && piece.color === game.turn()) {
        clearInvalidMoveFeedback();
        setSelectedSquare(square);
        const moves = game.moves({ square, verbose: true });
        setLegalMoves(moves.map(m => m.to as Square));
        return;
      }

      showInvalidMoveFeedback(square, 'THAT PIECE CANNOT MOVE THERE');
      return;
    }

    if (piece && piece.color === game.turn()) {
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
    mode,
    makePlayerMove,
    pendingPromotion,
    resignedBy,
    showInvalidMoveFeedback,
  ]);

  const handlePieceDrop = useCallback((from: Square, to: Square) => {
    if (pendingPromotion) return;
    if (resignedBy) return;
    if (game.isGameOver()) return;
    if (mode === 'cpu' && game.turn() === 'b') {
      showInvalidMoveFeedback(to, 'CPU THINKING');
      return;
    }

    const piece = game.get(from);
    if (!piece) {
      showInvalidMoveFeedback(from, 'SELECT A PIECE FIRST');
      return;
    }

    if (piece.color !== game.turn()) {
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

    makePlayerMove(from, to);
  }, [
    clearInvalidMoveFeedback,
    game,
    makePlayerMove,
    mode,
    pendingPromotion,
    resignedBy,
    showInvalidMoveFeedback,
  ]);

  const choosePromotion = useCallback((piece: PromotionPiece) => {
    if (!pendingPromotion) return;
    clearInvalidMoveFeedback();
    makePlayerMove(pendingPromotion.from, pendingPromotion.to, piece);
  }, [clearInvalidMoveFeedback, makePlayerMove, pendingPromotion]);

  const cancelPromotion = useCallback(() => {
    clearInvalidMoveFeedback();
    setPendingPromotion(null);
  }, [clearInvalidMoveFeedback]);

  useEffect(() => {
    scheduleCpuMove();
  }, [fen, scheduleCpuMove]);

  useEffect(() => {
    return clearCpuMoveTimer;
  }, [clearCpuMoveTimer]);

  useEffect(() => {
    return clearInvalidMoveTimer;
  }, [clearInvalidMoveTimer]);

  const undo = useCallback(() => {
    if (resignedBy) return;
    clearCpuMoveTimer();
    game.undo();
    if (mode === 'cpu' && game.turn() === 'b') game.undo();
    setSelectedSquare(null);
    setLegalMoves([]);
    setPendingPromotion(null);
    setLastMoveFeedback(null);
    clearInvalidMoveFeedback();
    setCpuThinking(false);
    updateStatus();
  }, [game, mode, resignedBy, updateStatus, clearCpuMoveTimer, clearInvalidMoveFeedback]);

  const surrender = useCallback(() => {
    if (game.isGameOver() || resignedBy) return;
    if (mode === 'cpu' && game.turn() === 'b') return;
    clearCpuMoveTimer();
    const side = game.turn() as 'w' | 'b';
    const winner = side === 'w' ? 'Black' : 'White';
    setResignedBy(side);
    setSelectedSquare(null);
    setLegalMoves([]);
    setPendingPromotion(null);
    setLastMoveFeedback(null);
    clearInvalidMoveFeedback();
    setCpuThinking(false);
    setFen(game.fen());
    updateCaptured();
    setStatusMessage(`${side === 'w' ? 'WHITE' : 'BLACK'} SURRENDERED! ${winner.toUpperCase()} WINS!`);
    setFlavorText("The match ended by surrender.");
    playGameOverSound();
  }, [game, mode, resignedBy, clearCpuMoveTimer, clearInvalidMoveFeedback, updateCaptured]);

  const reset = useCallback(() => {
    clearCpuMoveTimer();
    game.reset();
    setResignedBy(null);
    setSelectedSquare(null);
    setLegalMoves([]);
    setPendingPromotion(null);
    setLastMoveFeedback(null);
    clearInvalidMoveFeedback();
    setCapturedPieces({ w: [], b: [] });
    setFen(game.fen());
    setStatusMessage("The battle begins...");
    setFlavorText("A new game dawns...");
    setCpuThinking(false);
  }, [game, clearCpuMoveTimer, clearInvalidMoveFeedback]);

  const history = game.history();
  const verboseHistory = game.history({ verbose: true });
  const moveHistory = verboseHistory.map((move) => ({
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
  }));
  const lastMove = verboseHistory[verboseHistory.length - 1];
  const highlightedSquares = lastMoveFeedback ? [lastMoveFeedback.from, lastMoveFeedback.to] : lastMove ? [lastMove.to] : [];
  const drawReason = getDrawMessage(game)?.reason ?? null;

  return {
    fen,
    board: game.board(),
    selectedSquare,
    legalMoves,
    highlightedSquares,
    currentTurn: game.turn() as 'w' | 'b',
    isCheck: game.isCheck(),
    isCheckmate: game.isCheckmate(),
    isDraw: game.isDraw(),
    drawReason,
    isGameOver: game.isGameOver() || resignedBy !== null,
    resignedBy,
    capturedPieces,
    statusMessage,
    flavorText,
    cpuThinking,
    pendingPromotion,
    lastMoveFeedback,
    invalidMoveFeedback,
    handleSquareClick,
    handlePieceDrop,
    choosePromotion,
    cancelPromotion,
    undo,
    surrender,
    reset,
    history,
    moveHistory,
    gameInstance: game,
  };
}
