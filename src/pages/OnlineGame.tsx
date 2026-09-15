import { translateText, localize, useLanguage } from '@/lib/i18n';
import GameActionMenu from '@/components/GameActionMenu';
import { ArrowLeft, Music2, Volume2, VolumeX, Pause } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import ChessScene from '@/components/ChessScene';
import WagerSettlementPanel from '@/components/WagerSettlementPanel';
import { useOnlinePvp } from '@/hooks/useOnlinePvp';
import { useRobinhoodWallet } from '@/hooks/useRobinhoodWallet';
import { wagerInvitePath } from '@/lib/wagerInvite';
import { playMenuClick, playMenuSelect, playTurnReadySound, setSoundEnabled } from '@/lib/sounds';
import { startMusic, stopMusic } from '@/lib/music';
import MoveHistoryPanel from '@/components/MoveHistoryPanel';
import PromotionPicker from '@/components/PromotionPicker';
import ActionBanner from '@/components/ActionBanner';
import GamePausePanel from '@/components/GamePausePanel';
import GameLoadingPanel from '@/components/GameLoadingPanel';
import MatchIntroOverlay from '@/components/MatchIntroOverlay';
import ConfirmActionDialog from '@/components/ConfirmActionDialog';
import PlayerTurnPanel, { type PlayerTurnSeat } from '@/components/PlayerTurnPanel';
import ConnectionStatusPanel from '@/components/ConnectionStatusPanel';
import { getInvalidMoveBannerEvent, getMoveBannerEvent, type ActionBannerEvent } from '@/lib/actionBannerEvents';
import { getPlayerDisplayName, readStoredPlayerName } from '@/lib/playerProfile';
import { readAudioPreferences, saveAudioPreferences } from '@/lib/audioPreferences';
import { describeMove } from '@/lib/moveHistoryDescription';
import QuickChatPanel from '@/components/QuickChatPanel';
import { useQuickChat } from '@/hooks/useQuickChat';

const PIECE_SYMBOLS: Record<string, string> = {
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
};

export default function OnlineGame() {
  const language = useLanguage();
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const wallet = useRobinhoodWallet();
  const [playerName] = useState(() => getPlayerDisplayName(sessionStorage.getItem('chess_player_name_v1') ?? readStoredPlayerName()));
  const handleGameSwitch = useCallback((nextGameId: string) => {
    navigate(`/game/${nextGameId}`, { replace: true });
  }, [navigate]);

  const {
    loading,
    error,
    board,
    selectedSquare,
    legalMoves,
    highlightedSquares,
    currentTurn,
    isCheckmate,
    isDraw,
    isGameOver,
    capturedPieces,
    statusMessage,
    flavorText,
    movePending,
    moveError,
    syncError,
    connectionStatus,
    connectionMessage: onlineConnectionMessage,
    lastSyncedAt,
    pendingPromotion,
    lastMoveFeedback,
    invalidMoveFeedback,
    handleSquareClick,
    handlePieceDrop,
    choosePromotion,
    cancelPromotion,
    history,
    moveHistory,
    playerColor,
    isMyTurn,
    opponentJoined,
    cancelWaitingMatch,
    surrenderMatch,
    retrySync,
    refundWager,
    claimWagerPrize,
    convertWagerPrizeToRblx,
    prepareWagerPrizeRblxSwap,
    claimTimeout,
    wagerClock,
    wagerSettlement,
    timeoutPending,
    surrenderPending,
    winner,
  } = useOnlinePvp(gameId, handleGameSwitch);
  const quickChat = useQuickChat({ gameId, playerColor: playerColor ?? 'w', enabled: opponentJoined && playerColor !== null });

  const [initialAudioPreferences] = useState(() => readAudioPreferences());
  const [musicOn, setMusicOn] = useState(initialAudioPreferences.musicOn);
  const [sfxOn, setSfxOn] = useState(initialAudioPreferences.sfxOn);
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const [pauseOpen, setPauseOpen] = useState(false);
  const [surrenderConfirmOpen, setSurrenderConfirmOpen] = useState(false);
  const [showMatchIntro, setShowMatchIntro] = useState(false);
  const [onlineNoticeEvent, setOnlineNoticeEvent] = useState<ActionBannerEvent | null>(null);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousOpponentJoinedRef = useRef(false);
  const previousIsMyTurnRef = useRef(false);

  useEffect(() => {
    setSoundEnabled(sfxOn);
  }, [sfxOn]);

  useEffect(() => {
    if (musicOn) {
      startMusic();
    } else {
      stopMusic();
    }
    return () => stopMusic();
  }, [musicOn]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
      if (noticeTimeoutRef.current) {
        clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!opponentJoined) {
      setShowMatchIntro(false);
      previousOpponentJoinedRef.current = false;
      return;
    }

    setShowMatchIntro(true);
    const timer = setTimeout(() => setShowMatchIntro(false), 1700);
    return () => clearTimeout(timer);
  }, [opponentJoined, playerColor, playerName]);

  useEffect(() => {
    if (!opponentJoined) return;
    if (previousOpponentJoinedRef.current) return;

    previousOpponentJoinedRef.current = true;
    const colorLabel = playerColor === 'b' ? 'BLACK' : 'WHITE';

    if (noticeTimeoutRef.current) {
      clearTimeout(noticeTimeoutRef.current);
    }
    setOnlineNoticeEvent({
      id: `opponent-joined-${gameId}-${colorLabel}-${Date.now()}`,
      title: 'CHALLENGER FOUND',
      subtitle: `YOU ARE ${colorLabel}`,
      tone: 'promotion',
    });
    playMenuSelect();
    noticeTimeoutRef.current = setTimeout(() => {
      setOnlineNoticeEvent(null);
      noticeTimeoutRef.current = null;
    }, 1650);
  }, [gameId, opponentJoined, playerColor]);

  useEffect(() => {
    if (
      opponentJoined &&
      isMyTurn &&
      !previousIsMyTurnRef.current &&
      !isGameOver &&
      history.length > 0
    ) {
      playTurnReadySound();
    }
    previousIsMyTurnRef.current = isMyTurn;
  }, [history.length, isGameOver, isMyTurn, opponentJoined]);

  useEffect(() => {
    if (isGameOver) {
      setSurrenderConfirmOpen(false);
    }
  }, [isGameOver]);

  const toggleMusic = () => {
    const next = !musicOn;
    setMusicOn(next);
    saveAudioPreferences({ musicOn: next });
    playMenuClick();
  };

  const toggleSfx = () => {
    const next = !sfxOn;
    setSfxOn(next);
    setSoundEnabled(next);
    saveAudioPreferences({ sfxOn: next });
    playMenuClick();
  };


  const handleBack = async () => {
    playMenuClick();
    try {
      await cancelWaitingMatch(wallet);
    } finally {
      navigate('/');
    }
  };

  const showCopyState = (nextState: 'copied' | 'failed') => {
    if (copyResetTimeoutRef.current) {
      clearTimeout(copyResetTimeoutRef.current);
    }
    setCopyState(nextState);
    copyResetTimeoutRef.current = setTimeout(() => {
      setCopyState('idle');
      copyResetTimeoutRef.current = null;
    }, 2000);
  };

  const copyLink = async () => {
    const url = !opponentJoined && gameId && wagerSettlement.paymentMode === 'robinhood_eth_escrow' && wagerSettlement.stakeRaw
      ? `${window.location.origin}${wagerInvitePath(gameId, wagerSettlement.stakeRaw)}`
      : window.location.href;
    playMenuClick();
    setCopyState('copying');

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(url);
      showCopyState('copied');
    } catch (err) {
      console.error('Failed to copy game link', err);
      showCopyState('failed');
    }
  };

  const confirmSurrender = useCallback(async () => {
    playMenuClick();
    await surrenderMatch();
    setSurrenderConfirmOpen(false);
  }, [surrenderMatch]);

  const resultHeadline = isCheckmate
    ? 'CHECKMATE!'
    : isDraw
      ? 'DRAW!'
      : wagerSettlement.resultType === 'timeout'
        ? 'TIMEOUT!'
        : wagerSettlement.resultType === 'resignation'
          ? 'SURRENDER!'
          : 'MATCH COMPLETE';

  const resultDetail = isCheckmate
    ? `${currentTurn === 'w' ? 'BLACK' : 'WHITE'} WINS!`
    : wagerSettlement.resultType === 'resignation' && winner === 'w'
      ? 'WHITE WINS BY SURRENDER!'
      : wagerSettlement.resultType === 'resignation' && winner === 'b'
        ? 'BLACK WINS BY SURRENDER!'
        : winner === 'w'
          ? 'WHITE WINS!'
          : winner === 'b'
            ? 'BLACK WINS!'
            : winner === 'draw' || isDraw
              ? 'THE BATTLE ENDS IN A DRAW'
              : 'AWAITING REFEREE RESULT';

  if (loading) {
    return <GameLoadingPanel title={translateText("LOADING ONLINE GAME")} subtitle={translateText("SYNCING MATCH STATE")} />;
  }

  if (error) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background gap-4 p-4">
        <div className="game-error-panel retro-panel">
          <p className="game-error-title">{translateText("ONLINE GAME ERROR")}</p>
          <p className="game-error-copy">{localize(error)}</p>
          <button className="retro-btn" onClick={handleBack}>{translateText("MENU")}</button>
          <a className="block mt-4 text-primary underline" href="/funds">{translateText("Recover my match or funds")}</a>
        </div>
      </div>
    );
  }

  const statusAlert = syncError || moveError;
  const statusText = statusAlert || (movePending ? 'SAVING MOVE...' : statusMessage);
  const invalidMoveBannerEvent = getInvalidMoveBannerEvent(invalidMoveFeedback);
  const actionBannerEvent = statusAlert
    ? { id: `alert-${statusAlert}`, title: 'ONLINE ALERT', subtitle: statusAlert, tone: 'alert' as const }
    : pendingPromotion
      ? {
          id: `promotion-${pendingPromotion.from}-${pendingPromotion.to}`,
          title: 'PROMOTION!',
          subtitle: `${pendingPromotion.from.toUpperCase()} TO ${pendingPromotion.to.toUpperCase()}`,
          tone: 'promotion' as const,
        }
      : invalidMoveBannerEvent ?? (movePending
          ? { id: 'saving-move', title: 'SAVING MOVE', subtitle: 'ONLINE PVP', tone: 'saving' as const }
          : onlineNoticeEvent ?? getMoveBannerEvent(lastMoveFeedback));
  const movePulseKey = lastMoveFeedback?.id ?? null;
  const capturePulseKey = lastMoveFeedback?.isCapture ? lastMoveFeedback.id : null;
  const lastMoveDescription = moveHistory.length > 0
    ? describeMove(moveHistory[moveHistory.length - 1], language)
    : null;
  const copyButtonText =
    copyState === 'copying'
      ? 'COPYING...'
      : copyState === 'copied'
        ? 'COPIED!'
        : copyState === 'failed'
          ? 'COPY FAILED'
          : 'COPY LINK';
  const copyNote =
    copyState === 'copied'
      ? 'MATCH LINK COPIED'
      : copyState === 'failed'
        ? 'COPY FAILED. USE THE ADDRESS BAR.'
        : null;
  const waitingTitle = wagerSettlement.isWagered
    ? 'SEARCHING FOR WAGER OPPONENT...'
    : 'SEARCHING FOR OPPONENT...';
  const waitingSubtitle = wagerSettlement.isWagered
    ? 'Escrow funded. Matching same-stake players.'
    : 'You are in the public matchmaking queue.';
  const myColor = playerColor ?? 'w';
  const myColorLabel = myColor === 'w' ? 'WHITE' : 'BLACK';
  const playerTurnStatus = !opponentJoined
    ? 'WAITING'
    : isGameOver
      ? 'MATCH ENDED'
      : movePending
        ? 'SAVING MOVE'
        : isMyTurn
          ? 'YOUR TURN'
          : 'OPPONENT TURN';
  const playerTurnActiveLabel = !opponentJoined
    ? 'WAITING FOR OPPONENT'
    : isGameOver
      ? resultHeadline
      : currentTurn === 'w'
        ? 'WHITE TO MOVE'
        : 'BLACK TO MOVE';
  const playerTurnSeats: [PlayerTurnSeat, PlayerTurnSeat] = [
    {
      color: 'w',
      clock: wagerClock.isClocked ? wagerClock.whiteLabel : undefined,
      name: myColor === 'w' ? playerName : opponentJoined ? 'OPPONENT' : 'OPEN SEAT',
      label: myColor === 'w' ? 'YOU' : opponentJoined ? 'OPPONENT' : 'WAITING',
      active: currentTurn === 'w',
      tone: myColor === 'w' ? 'local' : opponentJoined ? 'opponent' : 'waiting',
    },
    {
      color: 'b',
      clock: wagerClock.isClocked ? wagerClock.blackLabel : undefined,
      name: myColor === 'b' ? playerName : opponentJoined ? 'OPPONENT' : 'OPEN SEAT',
      label: myColor === 'b' ? 'YOU' : opponentJoined ? 'OPPONENT' : 'WAITING',
      active: currentTurn === 'b',
      tone: myColor === 'b' ? 'local' : opponentJoined ? 'opponent' : 'waiting',
    },
  ];
  const statusFlavor = statusAlert
    || invalidMoveFeedback?.message
    || (lastMoveDescription ? `LAST: ${lastMoveDescription}` : flavorText || (isMyTurn ? 'YOUR TURN' : opponentJoined ? 'WAITING' : 'INVITE OPEN'));

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
            {playerName} • {localize(myColorLabel)}
          </p>
        </div>
        <div className="game-topbar-actions">
          <button className="retro-btn retro-btn-small" onClick={() => { setPauseOpen(true); playMenuClick(); }}>
            <Pause size={14}/>{translateText(" PAUSE")}</button>

          <GameActionMenu musicOn={musicOn} sfxOn={sfxOn} onMusic={toggleMusic} onSfx={toggleSfx}
            onSurrender={() => { setSurrenderConfirmOpen(true); playMenuClick(); }}
            surrenderDisabled={!opponentJoined || isGameOver || surrenderPending} />
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
          cpuMode={false}
          cpuThinking={false}
          flipped={myColor === 'b'}
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

        <MoveHistoryPanel history={history} moves={moveHistory} title={translateText("PVP LOG")} pulseKey={movePulseKey} />

        <ActionBanner event={actionBannerEvent} />

        <ConnectionStatusPanel
          gameStatus={connectionStatus}
          chatStatus={opponentJoined ? quickChat.status : null}
          message={onlineConnectionMessage ?? (lastSyncedAt ? 'Last referee sync restored.' : null)}
          onRetry={retrySync}
        />

        <MatchIntroOverlay
          show={showMatchIntro && !pauseOpen && !isGameOver}
          title={translateText("CHALLENGE LIVE")}
          matchup="WHITE VS BLACK"
          subtitle={localize(`${playerName} • ${myColorLabel} SEAT`)}
        />

        {localize(opponentJoined && (
          <QuickChatPanel
            messages={quickChat.messages}
            status={quickChat.status}
            onSend={quickChat.sendQuickChat}
          />
        ))}

        {localize(pendingPromotion && (
          <PromotionPicker
            color={pendingPromotion.color}
            disabled={movePending}
            onSelect={choosePromotion}
            onCancel={cancelPromotion}
          />
        ))}

        {localize(wagerClock.canClaimTimeout && <div className="sky-timeout-claim"><button className="retro-btn retro-btn-small retro-btn-gold" onClick={() => { playMenuClick(); claimTimeout(wallet); }} disabled={timeoutPending}>{localize(timeoutPending ? 'CLAIMING...' : 'CLAIM TIMEOUT')}</button></div>)}

        {localize(!opponentJoined && (
          <div className="absolute inset-0 flex items-center justify-center z-20 bg-background/80">
            <div className="retro-panel p-8 text-center retro-slide-up max-w-sm">
              <p className="text-sm font-retro text-primary retro-glow mb-4">
                {localize(waitingTitle)}
              </p>
              <p className="text-[8px] font-retro text-muted-foreground mb-4">
                {localize(waitingSubtitle)}
              </p>
              <div className="retro-panel px-3 py-2 mb-4">
                <p className="text-[7px] font-retro text-foreground break-all">
                  {playerName}{translateText(" IS QUEUED")}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <button className="retro-btn retro-btn-gold" onClick={copyLink} disabled={copyState === 'copying'}>
                  {localize(copyButtonText)}
                </button>
                <button className="retro-btn" onClick={handleBack}>{translateText("CANCEL SEARCH")}</button>
              </div>
              {localize(copyNote && (
                <p className="copy-link-note" aria-live="polite">
                  {localize(copyNote)}
                </p>
              ))}
              <p className="text-[7px] font-retro text-muted-foreground mt-4 retro-blink">{translateText("SCANNING FOR CHALLENGERS...")}</p>
            </div>
          </div>
        ))}

        {localize(isGameOver && (
          <div className="game-over-overlay">
            <div className="game-over-panel retro-panel p-8 text-center retro-slide-up max-w-md">
              <div className="endgame-burst" aria-hidden="true" />
              <p className="text-lg font-retro text-retro-gold retro-glow-gold mb-4">
                {localize(resultHeadline)}
              </p>
              <p className="text-[8px] font-retro text-foreground mb-6">
                {localize(resultDetail)}
              </p>
              <WagerSettlementPanel
                summary={wagerSettlement}
                onRefund={() => refundWager(wallet)}
                onClaimEth={() => claimWagerPrize(wallet)}
                onPrepareRblxSwap={(claimHash) => prepareWagerPrizeRblxSwap(claimHash, wallet)}
                onConvertToRblx={(claimHash, quote) => convertWagerPrizeToRblx(claimHash, quote, wallet)}
                playerColor={playerColor}
              />
              <div className="game-over-actions">
                <button className="retro-btn retro-btn-gold" onClick={copyLink} disabled={copyState === 'copying'}>
                  {localize(copyButtonText)}
                </button>
                <button className="retro-btn" onClick={handleBack}>{translateText("MENU")}</button>
              </div>
              {localize(copyNote && (
                <p className="copy-link-note" aria-live="polite">
                  {localize(copyNote)}
                </p>
              ))}
            </div>
          </div>
        ))}

        {localize(opponentJoined && !isMyTurn && !isGameOver && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10">
            <div className="retro-panel px-4 py-2">
              <p className="text-[9px] font-retro text-muted-foreground retro-blink">{translateText("OPPONENT'S TURN...")}</p>
            </div>
          </div>
        ))}
      </div>

      <GamePausePanel
        open={pauseOpen}
        title={translateText("ONLINE PVP")}
        subtitle={localize(`${playerName} • ${myColorLabel} SEAT`)}
        status={statusText.toUpperCase()}
        moves={history.length}
        musicOn={musicOn}
        sfxOn={sfxOn}
        onClose={() => { setPauseOpen(false); playMenuClick(); }}
        onMenu={handleBack}
        onToggleMusic={toggleMusic}
        onToggleSfx={toggleSfx}
      />

      <ConfirmActionDialog
        open={surrenderConfirmOpen}
        title={translateText("SURRENDER MATCH?")}
        message="This submits a resignation to the referee and ends the online game."
        confirmLabel={translateText("SURRENDER")}
        pending={surrenderPending}
        onCancel={() => { setSurrenderConfirmOpen(false); playMenuClick(); }}
        onConfirm={confirmSurrender}
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
            <p className={`game-status-title ${statusAlert ? 'text-destructive' : movePending ? 'text-retro-gold' : 'text-primary'}`}>
              {localize(statusText)}
            </p>
          </div>
        </div>
        <div className="game-status-meta">
          <p className="game-status-flavor">
            {localize(statusFlavor)}
          </p>
          <p className="game-status-count">{translateText("MOVES: ")}{localize(history.length)}
          </p>
        </div>
      </div>
    </div>
  );
}
