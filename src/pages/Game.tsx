import { translateText, localize, useLanguage } from '@/lib/i18n';
import GameActionMenu from '@/components/GameActionMenu';
import { ArrowLeft, Music2, Volume2, VolumeX, Pause, Flag, Undo2, RotateCcw } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import ChessScene from '@/components/ChessScene';
import TypewriterText from '@/components/TypewriterText';
import { useChessGame, type GameMode, type Difficulty } from '@/hooks/useChessGame';
import { playMenuClick, playTurnReadySound, setSoundEnabled } from '@/lib/sounds';
import { startMusic, stopMusic } from '@/lib/music';
import { CHARACTERS, type CpuCharacter } from '@/lib/characterTaunts';
import MoveHistoryPanel from '@/components/MoveHistoryPanel';
import PromotionPicker from '@/components/PromotionPicker';
import ActionBanner from '@/components/ActionBanner';
import GamePausePanel from '@/components/GamePausePanel';
import OpponentPresencePanel from '@/components/OpponentPresencePanel';
import MatchIntroOverlay from '@/components/MatchIntroOverlay';
import ConfirmActionDialog from '@/components/ConfirmActionDialog';
import PlayerTurnPanel, { type PlayerTurnSeat } from '@/components/PlayerTurnPanel';
import { getInvalidMoveBannerEvent, getMoveBannerEvent } from '@/lib/actionBannerEvents';
import { getPlayerDisplayName } from '@/lib/playerProfile';
import { readAudioPreferences, saveAudioPreferences } from '@/lib/audioPreferences';
import { describeMove } from '@/lib/moveHistoryDescription';
import { submitCpuResult } from '@/lib/cpuLeaderboard';
import { isSupabaseConfigured } from '@/lib/supabaseConfig';
import { signWalletProof } from '@/lib/wagerRefereeClient';
import { useSolanaWallet } from '@/hooks/useSolanaWallet';
import {
  normalizeLocalGameConfig,
  readLocalGameConfig,
  saveLocalGameConfig,
  type LocalGameConfig,
} from '@/lib/localGameConfig';

const PIECE_SYMBOLS: Record<string, string> = {
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
};

const TAUNT_DURATION_MS = 24_000;
const IDLE_TAUNT_DELAY_MS = 8_000;

function createCpuMatchRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cpu:${crypto.randomUUID()}`;
  }
  return `cpu:${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

export default function Game() {
  const language = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const routeConfig = normalizeLocalGameConfig(location.state);
  const [launchConfig] = useState<LocalGameConfig>(() =>
    routeConfig ?? readLocalGameConfig() ?? { mode: 'pvp', difficulty: 'medium' }
  );
  const wallet = useSolanaWallet();

  const mode: GameMode = launchConfig.mode;
  const difficulty: Difficulty = launchConfig.difficulty;
  const cpuCharacter: CpuCharacter = launchConfig.cpuCharacter || 'ivan';
  const character = CHARACTERS[cpuCharacter];
  const [initialAudioPreferences] = useState(() => readAudioPreferences());
  const initialSoundEnabled = launchConfig.soundEnabled ?? initialAudioPreferences.sfxOn;
  const playerName = getPlayerDisplayName(launchConfig.playerName);

  const [musicOn, setMusicOn] = useState(initialAudioPreferences.musicOn);
  const [sfxOn, setSfxOn] = useState(initialSoundEnabled);
  const [cpuTaunt, setCpuTaunt] = useState<string | null>(null);
  const [idleTauntIndex, setIdleTauntIndex] = useState(0);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [surrenderConfirmOpen, setSurrenderConfirmOpen] = useState(false);
  const [introSeed, setIntroSeed] = useState(0);
  const [showMatchIntro, setShowMatchIntro] = useState(true);
  const [cpuMatchRequestId, setCpuMatchRequestId] = useState(createCpuMatchRequestId);
  const tauntTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousTurnRef = useRef<'w' | 'b' | null>(null);
  const submittedCpuMatchRef = useRef<string | null>(null);

  const clearTauntTimeout = useCallback(() => {
    if (tauntTimeoutRef.current) {
      clearTimeout(tauntTimeoutRef.current);
      tauntTimeoutRef.current = null;
    }
  }, []);

  const showCpuTaunt = useCallback((taunt: string) => {
    clearTauntTimeout();
    setCpuTaunt(taunt);
    tauntTimeoutRef.current = setTimeout(() => {
      setCpuTaunt(null);
      tauntTimeoutRef.current = null;
    }, TAUNT_DURATION_MS);
  }, [clearTauntTimeout]);

  const toggleSfx = () => {
    const next = !sfxOn;
    setSfxOn(next);
    setSoundEnabled(next);
    saveAudioPreferences({ sfxOn: next });
    playMenuClick();
  };

  useEffect(() => {
    setSoundEnabled(sfxOn);
  }, [sfxOn]);

  useEffect(() => {
    saveLocalGameConfig(launchConfig);
  }, [launchConfig]);

  useEffect(() => {
    if (musicOn) {
      startMusic();
    } else {
      stopMusic();
    }
    return () => stopMusic();
  }, [musicOn]);

  useEffect(() => {
    return clearTauntTimeout;
  }, [clearTauntTimeout]);

  useEffect(() => {
    if (mode === 'cpu') return;

    clearTauntTimeout();
    setCpuTaunt(null);
  }, [mode, clearTauntTimeout]);

  const toggleMusic = () => {
    const next = !musicOn;
    setMusicOn(next);
    saveAudioPreferences({ musicOn: next });
    playMenuClick();
  };


  const {
    board,
    selectedSquare,
    legalMoves,
    highlightedSquares,
    currentTurn,
    isCheck,
    isCheckmate,
    isGameOver,
    drawReason,
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
  } = useChessGame(mode, difficulty);

  const startNewGame = useCallback(() => {
    setSurrenderConfirmOpen(false);
    reset();
    submittedCpuMatchRef.current = null;
    setCpuMatchRequestId(createCpuMatchRequestId());
    setIntroSeed((seed) => seed + 1);
  }, [reset]);

  useEffect(() => {
    setShowMatchIntro(true);
    const timer = setTimeout(() => setShowMatchIntro(false), 1700);
    return () => clearTimeout(timer);
  }, [mode, difficulty, cpuCharacter, playerName, introSeed]);

  useEffect(() => {
    if (isGameOver) {
      setSurrenderConfirmOpen(false);
    }
  }, [isGameOver]);

  const moveCount = history.length;
  const hasNoMoves = moveCount === 0;
  const lastMove = history[moveCount - 1];
  const lastMoveDescription = moveHistory.length > 0
    ? describeMove(moveHistory[moveHistory.length - 1], language)
    : null;

  useEffect(() => {
    if (mode !== 'cpu' || !isCheckmate || currentTurn !== 'b' || resignedBy || history.length === 0) return;
    if (submittedCpuMatchRef.current === cpuMatchRequestId) return;

    const requestId = cpuMatchRequestId;
    submittedCpuMatchRef.current = requestId;
    void (async () => {
      const payoutFields = wallet.address && wallet.signMessage && isSupabaseConfigured
        ? await signWalletProof({
          action: 'submit_cpu_result',
          walletAddress: wallet.address,
          signMessage: wallet.signMessage,
        }).then((walletProof) => ({
          walletAddress: wallet.address ?? undefined,
          ...walletProof,
        })).catch((err) => {
          console.warn('Failed to sign CPU reward wallet proof', err);
          return {};
        })
        : {};

      await submitCpuResult({
        requestId,
        playerName,
        difficulty,
        cpuCharacter,
        moves: [...history],
        ...payoutFields,
      });
    })().catch((err) => {
      console.warn('Failed to submit CPU leaderboard result', err);
    });
  }, [
    cpuCharacter,
    cpuMatchRequestId,
    currentTurn,
    difficulty,
    history,
    isCheckmate,
    mode,
    playerName,
    resignedBy,
    wallet.address,
    wallet.signMessage,
  ]);

  const statusFlavor = invalidMoveFeedback?.message
    ?? (isGameOver ? flavorText : lastMoveDescription ? `LAST: ${lastMoveDescription}` : 'MAKE THE FIRST MOVE');
  const actionBannerEvent = pendingPromotion
    ? {
        id: `promotion-${pendingPromotion.from}-${pendingPromotion.to}`,
        title: 'PROMOTION!',
        subtitle: `${pendingPromotion.from.toUpperCase()} TO ${pendingPromotion.to.toUpperCase()}`,
        tone: 'promotion' as const,
      }
    : getInvalidMoveBannerEvent(invalidMoveFeedback) ?? getMoveBannerEvent(lastMoveFeedback);
  const movePulseKey = lastMoveFeedback?.id ?? null;
  const capturePulseKey = lastMoveFeedback?.isCapture ? lastMoveFeedback.id : null;
  const opponentMood = cpuThinking
    ? 'THINKING'
    : resignedBy
      ? 'MATCH ENDED'
      : isGameOver && isCheckmate
        ? currentTurn === 'w' ? 'VICTORIOUS' : 'DEFEATED'
        : isCheck
          ? 'KING HUNT'
          : lastMoveFeedback?.isCapture && lastMoveFeedback.color === 'b'
            ? 'TOOK MATERIAL'
            : 'WATCHING';
  const opponentAccent = resignedBy
    ? 'gold'
    : isGameOver && isCheckmate
      ? currentTurn === 'w' ? 'red' : 'gold'
      : isCheck
        ? 'red'
        : cpuThinking
          ? 'gold'
          : 'green';
  const playerTurnStatus = isGameOver
    ? 'MATCH ENDED'
    : mode === 'cpu' && currentTurn === 'b'
      ? cpuThinking ? 'CPU THINKING' : `${translateText(character.name)} TO MOVE`
      : currentTurn === 'w'
        ? `${playerName} TO MOVE`
        : 'PLAYER 2 TO MOVE';
  const playerTurnActiveLabel = isGameOver
    ? resignedBy
      ? `${resignedBy === 'w' ? 'WHITE' : 'BLACK'} SURRENDERED`
      : isCheckmate
        ? 'CHECKMATE'
        : 'DRAW'
    : currentTurn === 'w'
      ? 'WHITE TO MOVE'
      : 'BLACK TO MOVE';
  const playerTurnSeats: [PlayerTurnSeat, PlayerTurnSeat] = [
    {
      color: 'w',
      name: playerName,
      label: 'YOU',
      active: currentTurn === 'w',
      tone: 'local',
    },
    {
      color: 'b',
      name: translateText(mode === 'cpu' ? character.name : 'PLAYER 2'),
      label: mode === 'cpu' ? `CPU ${translateText(difficulty.toUpperCase())}` : 'LOCAL',
      active: currentTurn === 'b',
      tone: mode === 'cpu' ? 'cpu' : 'opponent',
    },
  ];

  useEffect(() => {
    if (mode !== 'cpu') return;
    if (hasNoMoves) {
      const taunts = character.taunts.opening;
      const taunt = taunts[Math.floor(Math.random() * taunts.length)];
      showCpuTaunt(taunt);
    }
  }, [mode, hasNoMoves, character, showCpuTaunt]);

  useEffect(() => {
    if (mode !== 'cpu' || moveCount < 1) return;

    const isCpuMove = moveCount % 2 === 0;
    let taunt: string;

    if (isCpuMove) {
      if (isCheckmate && currentTurn === 'w') {
        taunt = character.taunts.checkmate[Math.floor(Math.random() * character.taunts.checkmate.length)];
      } else if (isCheck) {
        taunt = character.taunts.check[Math.floor(Math.random() * character.taunts.check.length)];
      } else if (lastMove && lastMove.includes('x')) {
        taunt = character.taunts.capture[Math.floor(Math.random() * character.taunts.capture.length)];
      } else {
        taunt = character.taunts.general[Math.floor(Math.random() * character.taunts.general.length)];
      }
    } else {
      taunt = character.taunts.playerMove[Math.floor(Math.random() * character.taunts.playerMove.length)];
    }

    showCpuTaunt(taunt);
  }, [moveCount, lastMove, mode, isCheck, isCheckmate, currentTurn, character, showCpuTaunt]);

  useEffect(() => {
    setIdleTauntIndex(0);
  }, [moveCount]);

  useEffect(() => {
    const previousTurn = previousTurnRef.current;
    previousTurnRef.current = currentTurn;
    if (
      mode === 'cpu' &&
      previousTurn === 'b' &&
      currentTurn === 'w' &&
      moveCount > 0 &&
      !isGameOver
    ) {
      playTurnReadySound();
    }
  }, [currentTurn, isGameOver, mode, moveCount]);

  useEffect(() => {
    if (mode !== 'cpu' || isGameOver || currentTurn !== 'w') return;
    const idleTaunts = character.taunts.idle;
    const idleTimer = setTimeout(() => {
      const index = Math.min(idleTauntIndex, idleTaunts.length - 1);
      const taunt = idleTaunts[index];
      showCpuTaunt(taunt);
      setIdleTauntIndex(prev => prev + 1);
    }, IDLE_TAUNT_DELAY_MS);
    return () => clearTimeout(idleTimer);
  }, [moveCount, mode, isGameOver, currentTurn, idleTauntIndex, character, showCpuTaunt]);

  const handleBack = () => {
    playMenuClick();
    navigate('/');
  };

  const bubbleTextStyle = cpuCharacter === 'vinnie'
    ? { textShadow: '0 0 10px hsl(25, 100%, 50%), 0 0 20px hsl(25, 100%, 50%, 0.5)' }
    : { textShadow: '0 0 10px hsl(var(--primary)), 0 0 20px hsl(var(--primary)/0.5)' };

  const bubbleTextClass = cpuCharacter === 'vinnie'
    ? 'text-orange-400'
    : 'text-primary retro-glow';

  return (
    <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
      <div className="game-topbar retro-panel border-t-0 border-x-0 z-10">
        <div className="game-topbar-left">
          <button className="retro-btn retro-btn-small" onClick={handleBack}>
            <ArrowLeft size={14}/>{translateText(" MENU")}</button>
        </div>
        <div className="game-title-block">
          <p className="stone-label text-[8px] font-retro">{translateText("CHESSBLOX")}</p>
          <p className="text-[6px] font-retro text-muted-foreground mt-0.5">
            {localize(mode === 'cpu' ? `${playerName} VS ${translateText(character.name)} • ${translateText(difficulty.toUpperCase())}` : `${playerName} • LOCAL MATCH`)}
          </p>
        </div>
        <div className="game-topbar-actions">
          <button className="retro-btn retro-btn-small" onClick={() => { setPauseOpen(true); playMenuClick(); }}>
            <Pause size={14}/>{translateText(" PAUSE")}</button>

          <button
            className="retro-btn retro-btn-small"
            onClick={() => { undo(); playMenuClick(); }}
            disabled={moveCount === 0 || isGameOver || cpuThinking}
          >
            <Undo2 size={14}/>{translateText(" UNDO")}</button>
          <GameActionMenu musicOn={musicOn} sfxOn={sfxOn} onMusic={toggleMusic} onSfx={toggleSfx}
            onSurrender={() => { setSurrenderConfirmOpen(true); playMenuClick(); }}
            surrenderDisabled={isGameOver || cpuThinking || (mode === 'cpu' && currentTurn === 'b')}
            onNew={() => { startNewGame(); playMenuClick(); }} />
        </div>
      </div>

      <div className="flex-1 relative min-h-0">
        <ChessScene
          board={board}
          selectedSquare={selectedSquare}
          legalMoves={legalMoves}
          highlightedSquares={highlightedSquares}
          invalidSquare={invalidMoveFeedback?.square ?? null}
          impactSignal={lastMoveFeedback ? { id: lastMoveFeedback.id, tone: lastMoveFeedback.tone } : null}
          moveFeedback={lastMoveFeedback}
          onSquareClick={handleSquareClick}
          onPieceDrop={handlePieceDrop}
          cpuMode={mode === 'cpu'}
          cpuThinking={cpuThinking}
          cpuCharacter={cpuCharacter}
        />


        <PlayerTurnPanel
          seats={playerTurnSeats}
          status={playerTurnStatus}
          activeLabel={playerTurnActiveLabel}
        />

        <div
          key={capturePulseKey ?? 'captured-idle'}
          className={`captured-pieces-stack ${capturePulseKey ? 'is-pulsing' : ''}`}
        >
          {localize(capturedPieces.w.length > 0 && (
            <div className="retro-panel px-2 py-1 mb-1">
              <p className="text-[6px] font-retro text-muted-foreground mb-0.5">{translateText("WHITE CAPTURED")}</p>
              <p className="text-sm">
                {localize(capturedPieces.w.map((p, i) => (
                  <span key={i} className="text-foreground opacity-70">{localize(PIECE_SYMBOLS[p])}</span>
                )))}
              </p>
            </div>
          ))}
          {localize(capturedPieces.b.length > 0 && (
            <div className="retro-panel px-2 py-1">
              <p className="text-[6px] font-retro text-muted-foreground mb-0.5">{translateText("BLACK CAPTURED")}</p>
              <p className="text-sm">
                {localize(capturedPieces.b.map((p, i) => (
                  <span key={i} className="text-foreground opacity-70">{localize(PIECE_SYMBOLS[p])}</span>
                )))}
              </p>
            </div>
          ))}
        </div>

        <MoveHistoryPanel history={history} moves={moveHistory} pulseKey={movePulseKey} />

        <ActionBanner event={actionBannerEvent} />

        <MatchIntroOverlay
          show={showMatchIntro && !pauseOpen && !isGameOver}
          title={translateText("MATCH START")}
          matchup={mode === 'cpu' ? `${playerName} VS ${translateText(character.name)}` : `${playerName} VS PLAYER 2`}
          subtitle={localize(mode === 'cpu' ? `CPU ${translateText(difficulty.toUpperCase())}` : 'LOCAL MATCH')}
        />



        {localize(pendingPromotion && (
          <PromotionPicker
            color={pendingPromotion.color}
            onSelect={choosePromotion}
            onCancel={cancelPromotion}
          />
        ))}

        {localize(mode === 'cpu' && cpuTaunt && (
          <div className="cpu-taunt-anchor">
            <div className="cpu-taunt-bubble">
              <p className={`text-[11px] font-retro ${bubbleTextClass} leading-relaxed text-center`} style={bubbleTextStyle}>
                <TypewriterText text={localize(cpuTaunt)} speed={40} />
              </p>
            </div>
          </div>
        ))}

        {localize(isGameOver && (
          <div className="game-over-overlay">
            <div className="game-over-panel retro-panel p-8 text-center retro-slide-up">
              <div className="endgame-burst" aria-hidden="true" />
              <p className="text-lg font-retro text-retro-gold retro-glow-gold mb-4">
                {localize(resignedBy ? 'SURRENDER!' : isCheckmate ? 'CHECKMATE!' : 'DRAW!')}
              </p>
              <p className="text-[8px] font-retro text-foreground mb-6">
                {localize(resignedBy
                  ? `${resignedBy === 'w' ? 'WHITE' : 'BLACK'} SURRENDERED. ${resignedBy === 'w' ? 'BLACK' : 'WHITE'} WINS!`
                  : isCheckmate
                    ? mode === 'cpu'
                      ? currentTurn === 'w' ? character.winText : character.loseText
                      : `${currentTurn === 'w' ? 'BLACK' : 'WHITE'} WINS!`
                    : drawReason ?? 'THE BATTLE ENDS IN A DRAW')}
              </p>
              <div className="flex gap-3 justify-center">
                <button className="retro-btn retro-btn-gold" onClick={() => { startNewGame(); playMenuClick(); }}>{translateText("REMATCH")}</button>
                <button className="retro-btn" onClick={handleBack}>{translateText("MENU")}</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <GamePausePanel
        open={pauseOpen}
        title={localize(mode === 'cpu' ? `VS ${translateText(character.name)}` : 'PLAYER VS PLAYER')}
        subtitle={localize(mode === 'cpu' ? `${playerName} • ${translateText(difficulty.toUpperCase())}` : `${playerName} • LOCAL MATCH`)}
        status={resignedBy ? 'SURRENDER' : isGameOver ? (isCheckmate ? 'CHECKMATE' : 'DRAW') : statusMessage.toUpperCase()}
        moves={moveCount}
        musicOn={musicOn}
        sfxOn={sfxOn}
        onClose={() => { setPauseOpen(false); playMenuClick(); }}
        onMenu={handleBack}
        onToggleMusic={toggleMusic}
        onToggleSfx={toggleSfx}
        onNewGame={() => { setPauseOpen(false); startNewGame(); playMenuClick(); }}
      />

      <ConfirmActionDialog
        open={surrenderConfirmOpen}
        title={translateText("SURRENDER MATCH?")}
        message="This ends the current game and gives the win to the other side."
        confirmLabel={translateText("SURRENDER")}
        onCancel={() => { setSurrenderConfirmOpen(false); playMenuClick(); }}
        onConfirm={() => {
          playMenuClick();
          setSurrenderConfirmOpen(false);
          surrender();
        }}
      />

      <div className="game-statusbar retro-panel border-b-0 border-x-0 z-10">
        <div className="game-status-main">
          <div
            className={`turn-indicator ${
              currentTurn === 'w'
                ? 'bg-foreground border-foreground'
                : 'bg-background border-foreground'
            }`}
          />
          <div>
            <p className="game-status-title text-primary">
              {localize(statusMessage)}
            </p>
            {localize(cpuThinking && (
              <p className="game-status-subtitle text-retro-gold retro-blink">
                {localize(character.thinkingText)}
              </p>
            ))}
          </div>
        </div>
        <div className="game-status-meta">
          <p className="game-status-flavor">
            {localize(statusFlavor)}
          </p>
          <p className="game-status-count">{translateText("MOVES: ")}{localize(moveCount)}
          </p>
        </div>
      </div>
    </div>
  );
}
