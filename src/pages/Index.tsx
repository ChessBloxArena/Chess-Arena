import { useAutomaticPayoutReview } from "@/components/AutomaticPayoutReview";
import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { playMenuClick, playMenuSelect, playStartSound, setSoundEnabled } from '@/lib/sounds';
import type { GameMode, Difficulty } from '@/hooks/useChessGame';
import type { CpuCharacter } from '@/lib/characterTaunts';
import {
  createPvpLobby,
  hostRobinhoodWagerPvpLobby,
  joinPvpLobby,
  joinPvpQueue,
  joinRobinhoodWagerPvpLobby,
  joinRobinhoodWagerPvpQueue,
  listPvpLobbyDirectory,
  type PvpLobby,
  type PvpLobbyAccess,
  type PvpLobbyMatchType,
  type PvpQueueCount,
} from '@/hooks/useOnlinePvp';
import { useRobinhoodWallet } from '@/hooks/useRobinhoodWallet';
import { formatRawAmount, getWagerConfig, isWsolAsset } from '@/lib/wagerConfig';
import { describeWagerCostCopy, describeWagerStartState, estimateMinimumWagerEntryBalance, phaseLabel, type WagerUiPhase } from '@/lib/wagerMatchmaking';
import { isSupabaseConfigured } from '@/lib/supabaseConfig';
import { getPlayerDisplayName, normalizePlayerNameInput, readStoredPlayerName, saveStoredPlayerName } from '@/lib/playerProfile';
import { readAudioPreferences, saveAudioPreferences } from '@/lib/audioPreferences';
import { saveLocalGameConfig } from '@/lib/localGameConfig';
import { cpuDifficultyPoints, formatCpuChessReward, listCpuLeaderboard, type CpuLeaderboardEntry } from '@/lib/cpuLeaderboard';
import { parseTokenAmount } from '@/lib/solana-payments/amounts';
import { CHESS_TIME_CONTROL_FORMATS, DEFAULT_CHESS_FORMAT_ID, chessFormatById, chessFormatByTimeControl, chessFormatFamilyLabel, type ChessFormatFamily, type ChessFormatId } from '@/lib/chessFormats';
import WalletStatusPanel from '@/components/WalletStatusPanel';
import CpuLeaderboardPanel from '@/components/CpuLeaderboardPanel';
import ThemeSelector from '@/components/ThemeSelector';
import { useArenaTheme } from '@/hooks/useArenaTheme';
import { Check, Copy, Unplug, Wallet, ArrowLeft, Crown, Swords, Trophy } from 'lucide-react';
import SkyClubLobby from '@/components/SkyClubLobby';
import { readQuickPlayPreferences, saveQuickPlayPreferences } from '@/lib/quickPlayPreferences';
import { automaticRblxPayoutEnabled, rblxConversionEnabled, robinhoodEscrowAddress } from '@/lib/robinhoodChain';
import { wagerInvitePath } from '@/lib/wagerInvite';

const TitleChessScene = lazy(() => import('@/components/TitleChessScene'));

type Screen = 'press-start' | 'menu';
type ContractCopyState = 'idle' | 'copying' | 'copied' | 'failed';
type MenuTab = 'play' | 'leaderboard';
type OnlinePanelMode = 'lobbies' | 'create';
type LobbyFilter = 'all' | PvpLobbyMatchType;
type LobbyStakeMode = 'preset' | 'custom';

const DEFAULT_LAUNCH_CONTRACT_ADDRESS = 'Dp4pqN6R2WprUakMDdqjEdebFbNrdWRPJAeexpvYpump';
const DEFAULT_LAUNCH_TOKEN_SYMBOL = 'TOKEN';

function isLocalHost(): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function formatGroupedRawAmount(amount: bigint, decimals: number, maximumFractionDigits = 2): string {
  const formatted = formatRawAmount(amount, decimals, maximumFractionDigits);
  const [whole, fraction] = formatted.split('.');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
}

function wagerEntryErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Unable to start match';
  const code = err instanceof Error && "code" in err ? String((err as { code?: unknown }).code) : "";
  if (/reject|declin|denied|cancel/i.test(message)) {
    return "Wallet rejected the signature. No wager was entered.";
  }
  if (/expired|blockhash/i.test(message)) {
    return "Transaction expired. Start the wager again for a fresh sponsored transaction.";
  }
  if (code === "sponsor_treasury_low" || /treasury.*low|treasury.*refill/i.test(message)) {
    return "Sponsored wagers are paused while the treasury refills.";
  }
  if (code === "wager_paused" || /temporarily paused|wagers.*paused/i.test(message)) {
    return "Wagers are temporarily paused.";
  }
  if (code === "sponsor_unavailable" || /sponsor.*unavailable|sponsor service/i.test(message)) {
    return "Sponsor service unavailable. Try again shortly.";
  }
  if (code === "wager_hold_required" || /hold at least .* to enter sol wagers/i.test(message)) {
    return message;
  }
  if (code === "wager_hold_unavailable" || /holder check unavailable|ca balance unavailable/i.test(message)) {
    return "CA holder check unavailable. Try again shortly.";
  }
  return message;
}

function lobbyInviteUrl(gameId: string, stakeRaw?: string | null): string {
  return `${window.location.origin}${stakeRaw ? wagerInvitePath(gameId, stakeRaw) : `/game/${gameId}`}`;
}

function cleanLobbyName(value: string, playerDisplayName: string): string {
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, 24);
  return cleaned || `${playerDisplayName}'S LOBBY`.slice(0, 24);
}

function parseLobbyStakeInput(value: string, decimals: number): { amount: bigint | null; error: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { amount: null, error: 'Enter a custom wager amount.' };

  try {
    const amount = parseTokenAmount(trimmed, decimals);
    if (amount <= 0n) return { amount: null, error: 'Enter a wager above 0.' };
    return { amount, error: null };
  } catch {
    return { amount: null, error: 'Enter a valid wager amount.' };
  }
}

function copyTextWithSelection(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the selection path below for browsers that expose clipboard
      // but block it without a focused editable element.
    }
  }

  if (copyTextWithSelection(text)) return;

  throw new Error('Clipboard copy failed');
}

export default function Index() {
  const reviewPayout = useAutomaticPayoutReview();
  const [savedQuickPlay] = useState(readQuickPlayPreferences);
  const [screen, setScreen] = useState<Screen>('press-start');
  const [mode, setMode] = useState<GameMode>(savedQuickPlay.mode);
  const [difficulty, setDifficulty] = useState<Difficulty>(savedQuickPlay.difficulty);
  const [cpuCharacter, setCpuCharacter] = useState<CpuCharacter>(savedQuickPlay.character);
  const [soundOn, setSoundOn] = useState(() => readAudioPreferences().sfxOn);
  const [showOptions, setShowOptions] = useState(false);
  const [menuTab, setMenuTab] = useState<MenuTab>('play');
  const [pvpEntryMode, setPvpEntryMode] = useState<'practice' | 'wager'>(savedQuickPlay.entry);
  const [onlinePanelMode, setOnlinePanelMode] = useState<OnlinePanelMode>('lobbies');
  const [lobbyFilter, setLobbyFilter] = useState<LobbyFilter>('all');
  const [lobbyMatchType, setLobbyMatchType] = useState<PvpLobbyMatchType>('free');
  const [lobbyAccess, setLobbyAccess] = useState<PvpLobbyAccess>('open');
  const [quickFormatId, setQuickFormatId] = useState<ChessFormatId>(savedQuickPlay.format);
  const [lobbyFormatId, setLobbyFormatId] = useState<ChessFormatId>(DEFAULT_CHESS_FORMAT_ID);
  const [lobbyName, setLobbyName] = useState('PLAYER 1 LOBBY');
  const [lobbyStakeMode, setLobbyStakeMode] = useState<LobbyStakeMode>('preset');
  const [customStakeAmount, setCustomStakeAmount] = useState('');
  const [lobbies, setLobbies] = useState<PvpLobby[]>([]);
  const [queueCounts, setQueueCounts] = useState<PvpQueueCount[]>([]);
  const [lobbiesLoading, setLobbiesLoading] = useState(false);
  const [lobbyDirectoryError, setLobbyDirectoryError] = useState<string | null>(null);
  const [pendingLobbyId, setPendingLobbyId] = useState<string | null>(null);
  const [copiedLobbyGameId, setCopiedLobbyGameId] = useState<string | null>(null);
  const [lobbyCopyError, setLobbyCopyError] = useState<string | null>(null);
  const [cpuLeaderboardEntries, setCpuLeaderboardEntries] = useState<CpuLeaderboardEntry[]>([]);
  const [cpuLeaderboardLoading, setCpuLeaderboardLoading] = useState(false);
  const [cpuLeaderboardLoaded, setCpuLeaderboardLoaded] = useState(false);
  const [cpuLeaderboardError, setCpuLeaderboardError] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState(() => readStoredPlayerName());
  const [contractCopyState, setContractCopyState] = useState<ContractCopyState>('idle');
  const { themesEnabled } = useArenaTheme();
  const wagerConfig = getWagerConfig();
  const wagersEnabled = wagerConfig.newWagersEnabled && wagerConfig.realEscrowEnabled && Boolean(robinhoodEscrowAddress());
  const [selectedStakeLamports, setSelectedStakeLamports] = useState<bigint>(
    wagerConfig.presetStakeLamports.find(stake => stake.toString() === savedQuickPlay.stake) ?? wagerConfig.presetStakeLamports[0] ?? 0n
  );
  const [wagerPhase, setWagerPhase] = useState<WagerUiPhase>('idle');
  const [wagerError, setWagerError] = useState<string | null>(null);
  const wallet = useRobinhoodWallet();
  const wagerHoldBalance = {
    rawAmount: null as bigint | null,
    loading: false,
    refreshing: false,
    error: null as string | null,
    refresh: async () => undefined,
  };
  const [createError, setCreateError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    saveQuickPlayPreferences({ mode, entry: pvpEntryMode, format: quickFormatId, stake: selectedStakeLamports.toString(), difficulty, character: cpuCharacter });
  }, [mode, pvpEntryMode, quickFormatId, selectedStakeLamports, difficulty, cpuCharacter]);

  const handlePressStart = () => {
    playStartSound();
    setScreen('menu');
  };

  useEffect(() => { if (!wagersEnabled) setPvpEntryMode('practice'); }, [wagersEnabled]);

  const [matching, setMatching] = useState(false);
  const holdRequiredLabel = formatGroupedRawAmount(
    wagerConfig.holdGate.requiredRawAmount,
    wagerConfig.holdGate.decimals,
    0,
  );
  const holdBalanceLabel = wagerHoldBalance.rawAmount == null
    ? '--'
    : formatGroupedRawAmount(wagerHoldBalance.rawAmount, wagerConfig.holdGate.decimals, 2);
  const wagerStartState = {
    walletConnected: !!wallet.address,
    balanceLamports: wallet.balanceWei,
    stakeLamports: selectedStakeLamports,
    maxStakeLamports: wagerConfig.maxStakeLamports,
    newWagersEnabled: wagerConfig.newWagersEnabled,
    realEscrowEnabled: wagerConfig.realEscrowEnabled && Boolean(robinhoodEscrowAddress()),
    paymentMode: wagerConfig.paymentMode,
    sponsorSignerConfigured: !!wagerConfig.sponsorSignerUrl,
    sponsorStatus: wagerConfig.sponsorStatus,
    stakeUsesNativeSol: isWsolAsset(wagerConfig.asset),
    holdGateEnabled: wagerConfig.holdGate.enabled,
    holdBalanceRaw: wagerHoldBalance.rawAmount,
    holdRequiredRaw: wagerConfig.holdGate.requiredRawAmount,
    holdBalanceLoading: wagerHoldBalance.loading,
    holdBalanceError: wagerHoldBalance.error,
    holdSymbol: wagerConfig.holdGate.symbol,
    holdRequiredLabel,
  };
  const estimatedWagerEntryLamports = estimateMinimumWagerEntryBalance(wagerStartState);
  const wagerStart = describeWagerStartState(wagerStartState, wagerPhase);
  const wagerBlocker = wagerStart.blocker;
  const selectedStakeLabel = `${formatRawAmount(selectedStakeLamports, wagerConfig.asset.decimals)} ${wagerConfig.asset.symbol}`;
  const parsedCustomStake = parseLobbyStakeInput(customStakeAmount, wagerConfig.asset.decimals);
  const lobbyStakeLamports = lobbyStakeMode === 'custom'
    ? parsedCustomStake.amount ?? 0n
    : selectedStakeLamports;
  const lobbyStakeLabel = `${formatRawAmount(lobbyStakeLamports, wagerConfig.asset.decimals)} ${wagerConfig.asset.symbol}`;
  const lobbyWagerStartState = {
    ...wagerStartState,
    stakeLamports: lobbyStakeLamports,
  };
  const estimatedLobbyWagerEntryLamports = estimateMinimumWagerEntryBalance(lobbyWagerStartState);
  const lobbyWagerStart = describeWagerStartState(lobbyWagerStartState, wagerPhase);
  const lobbyWagerBlocker =
    lobbyMatchType === 'wager'
      ? lobbyStakeMode === 'custom' && parsedCustomStake.error
        ? parsedCustomStake.error
        : lobbyWagerStart.blocker
      : null;
  const quickFormat = chessFormatById(quickFormatId);
  const lobbyFormat = chessFormatById(lobbyFormatId);
  const queuePlayersFor = (matchType: PvpLobbyMatchType, timeControl: string, stakeRaw?: string) => (
    queueCounts.find((entry) => (
      entry.matchType === matchType &&
      entry.timeControl === timeControl &&
      (matchType === 'free' || entry.stakeRaw === stakeRaw)
    ))?.players ?? 0
  );
  const queueCopyFor = (players: number) => players > 0
    ? `${players} ${players === 1 ? 'PLAYER' : 'PLAYERS'} QUEUED`
    : null;
  const quickMatchType: PvpLobbyMatchType = pvpEntryMode === 'wager' ? 'wager' : 'free';
  const selectedQueueStakeRaw = quickMatchType === 'wager' ? selectedStakeLamports.toString() : undefined;
  const selectedQueuePlayers = queuePlayersFor(quickMatchType, quickFormat.timeControl, selectedQueueStakeRaw);
  const selectedQueueCopy = queueCopyFor(selectedQueuePlayers);
  const formatFamilies: ChessFormatFamily[] = ['bullet', 'blitz', 'rapid'];
  const showPrimaryStartButton = mode !== 'pvp' || onlinePanelMode === 'lobbies';
  const filteredLobbies = lobbies.filter((lobby) => lobbyFilter === 'all' || lobby.matchType === lobbyFilter);
  const wagerClusterLabel = 'ROBINHOOD CHAIN';
  const wagerCostCopy = describeWagerCostCopy({
    rblxConversionEnabled: rblxConversionEnabled(),
    automaticRblxPayoutEnabled: automaticRblxPayoutEnabled(),
    paymentMode: wagerConfig.paymentMode,
    sponsoredModeAvailable: wagerConfig.sponsoredModeAvailable,
    stakeLabel: selectedStakeLabel,
    assetSymbol: wagerConfig.asset.symbol,
    estimatedEntryLamports: estimatedWagerEntryLamports,
    holdGateEnabled: wagerConfig.holdGate.enabled,
    holdSymbol: wagerConfig.holdGate.symbol,
    holdRequiredLabel,
  });
  const lobbyWagerCostCopy = describeWagerCostCopy({
    rblxConversionEnabled: rblxConversionEnabled(),
    automaticRblxPayoutEnabled: automaticRblxPayoutEnabled(),
    paymentMode: wagerConfig.paymentMode,
    sponsoredModeAvailable: wagerConfig.sponsoredModeAvailable,
    stakeLabel: lobbyStakeLabel,
    assetSymbol: wagerConfig.asset.symbol,
    estimatedEntryLamports: estimatedLobbyWagerEntryLamports,
    holdGateEnabled: wagerConfig.holdGate.enabled,
    holdSymbol: wagerConfig.holdGate.symbol,
    holdRequiredLabel,
  });
  const playerDisplayName = getPlayerDisplayName(playerName);
  const configuredLaunchContractAddress = String(import.meta.env.VITE_LAUNCH_CONTRACT_ADDRESS ?? '').trim();
  const configuredLaunchTokenSymbol = String(import.meta.env.VITE_LAUNCH_TOKEN_SYMBOL ?? '').trim();
  const launchContractAddress =
    configuredLaunchContractAddress ||
    DEFAULT_LAUNCH_CONTRACT_ADDRESS ||
    (isWsolAsset(wagerConfig.asset) ? '' : wagerConfig.asset.mint);
  const launchTokenSymbol =
    configuredLaunchTokenSymbol ||
    (launchContractAddress === DEFAULT_LAUNCH_CONTRACT_ADDRESS ? DEFAULT_LAUNCH_TOKEN_SYMBOL : wagerConfig.asset.symbol);
  const hasLaunchContractAddress = launchContractAddress.length > 0;
  const contractCopyButtonText =
    contractCopyState === 'copying'
      ? 'COPYING'
      : contractCopyState === 'copied'
        ? 'COPIED'
        : 'COPY';
  const contractCopyStatus =
    contractCopyState === 'copied'
      ? 'CA COPIED TO CLIPBOARD'
      : contractCopyState === 'failed'
        ? 'COPY FAILED'
        : '';

  useEffect(() => {
    saveStoredPlayerName(playerName);
  }, [playerName]);

  useEffect(() => {
    setSoundEnabled(soundOn);
  }, [soundOn]);

  useEffect(() => {
    if (contractCopyState === 'idle' || contractCopyState === 'copying') return;
    const timeout = window.setTimeout(() => setContractCopyState('idle'), 1800);
    return () => window.clearTimeout(timeout);
  }, [contractCopyState]);

  const refreshLobbies = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (screen !== 'menu' || mode !== 'pvp') return;
    if (!options.quiet) setLobbiesLoading(true);
    try {
      const directory = await listPvpLobbyDirectory();
      setLobbies(directory.lobbies);
      setQueueCounts(directory.queueCounts);
      setLobbyDirectoryError(null);
    } catch (err) {
      console.warn('Failed to refresh lobby directory', err);
      setLobbyDirectoryError('LOBBY DIRECTORY STALE');
    } finally {
      if (!options.quiet) setLobbiesLoading(false);
    }
  }, [mode, screen]);

  const refreshCpuLeaderboard = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setCpuLeaderboardEntries([]);
      setCpuLeaderboardError(null);
      setCpuLeaderboardLoaded(true);
      return;
    }
    setCpuLeaderboardLoading(true);
    setCpuLeaderboardError(null);
    try {
      const entries = await listCpuLeaderboard(25);
      setCpuLeaderboardEntries(entries);
    } catch (err) {
      console.warn('Failed to refresh CPU leaderboard', err);
      setCpuLeaderboardError('LEADERBOARD SYNC FAILED');
    } finally {
      setCpuLeaderboardLoaded(true);
      setCpuLeaderboardLoading(false);
    }
  }, []);

  useEffect(() => {
    if (screen !== 'menu' || menuTab !== 'leaderboard' || cpuLeaderboardLoaded || cpuLeaderboardLoading) return;
    void refreshCpuLeaderboard();
  }, [cpuLeaderboardLoaded, cpuLeaderboardLoading, menuTab, refreshCpuLeaderboard, screen]);

  useEffect(() => {
    if (screen !== 'menu' || mode !== 'pvp') return;
    void refreshLobbies();
    const interval = window.setInterval(() => {
      void refreshLobbies({ quiet: true });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [mode, refreshLobbies, screen]);

  useEffect(() => {
    setLobbyName((current) => (
      current === 'PLAYER 1 LOBBY'
        ? `${playerDisplayName}'S LOBBY`.slice(0, 24)
        : current
    ));
  }, [playerDisplayName]);

  useEffect(() => {
    if (!copiedLobbyGameId && !lobbyCopyError) return;
    const timeout = window.setTimeout(() => {
      setCopiedLobbyGameId(null);
      setLobbyCopyError(null);
    }, 1800);
    return () => window.clearTimeout(timeout);
  }, [copiedLobbyGameId, lobbyCopyError]);

  const handleCopyContractAddress = async () => {
    if (!hasLaunchContractAddress) return;
    playMenuClick();
    setContractCopyState('copying');
    try {
      await copyTextToClipboard(launchContractAddress);
      setContractCopyState('copied');
    } catch (err) {
      console.error('Failed to copy launch contract address', err);
      setContractCopyState('failed');
    }
  };

  const enterWagerGame = async (stakeLamports: bigint, timeControl: string): Promise<string> => {
    if (!wallet.address) {
      throw new Error('Connect a wallet before entering wagered PvP.');
    }
    if (!wallet.signMessage) {
      throw new Error('Wallet proof required. Choose a wallet that can sign messages.');
    }

    setWagerPhase('signing');
    return joinRobinhoodWagerPvpQueue({
      address: wallet.address,
      stakeWei: stakeLamports,
      reviewPayout,
      timeControl,
      signMessage: wallet.signMessage,
      writeContract: async (transaction) => {
        setWagerPhase('signing');
        const signature = await wallet.writeContract(transaction);
        setWagerPhase('confirming');
        return signature;
      },
    });
  };

  const hostWagerLobbyGame = async (stakeLamports: bigint, timeControl: string): Promise<string> => {
    if (!wallet.address) {
      throw new Error('Connect a wallet before entering wagered PvP.');
    }
    if (!wallet.signMessage) {
      throw new Error('Wallet proof required. Choose a wallet that can sign messages.');
    }

    setWagerPhase('signing');
    return hostRobinhoodWagerPvpLobby({
      address: wallet.address,
      stakeWei: stakeLamports,
      reviewPayout,
      timeControl,
      signMessage: wallet.signMessage,
      writeContract: async (transaction) => {
        setWagerPhase('signing');
        const signature = await wallet.writeContract(transaction);
        setWagerPhase('confirming');
        return signature;
      },
    });
  };

  const handleCopyLobbyInvite = async (lobby: PvpLobby) => {
    playMenuClick();
    setLobbyCopyError(null);
    try {
      await copyTextToClipboard(lobbyInviteUrl(lobby.gameId, lobby.matchType === 'wager' ? lobby.stakeRaw : null));
      setCopiedLobbyGameId(lobby.gameId);
    } catch (err) {
      console.error('Failed to copy lobby invite', err);
      setLobbyCopyError('INVITE COPY FAILED');
    }
  };

  const handleOpenLobby = async (lobby: PvpLobby) => {
    playMenuSelect();
    setCreateError(null);
    setWagerError(null);
    setPendingLobbyId(lobby.id);
    try {
      if (lobby.matchType === 'wager') {
        const stakeLamports = BigInt(lobby.stakeRaw ?? '0');
        const joinWagerStart = describeWagerStartState({
          ...wagerStartState,
          stakeLamports,
        }, wagerPhase);
        if (joinWagerStart.blocker) throw new Error(joinWagerStart.blocker);
        if (!wallet.address) {
          throw new Error('Connect a wallet before entering wagered PvP.');
        }
        if (!wallet.signMessage) {
          throw new Error('Wallet proof required. Choose a wallet that can sign messages.');
        }
        const gameId = await joinRobinhoodWagerPvpLobby(lobby.gameId, {
          address: wallet.address,
          stakeWei: stakeLamports,
      reviewPayout,
          signMessage: wallet.signMessage,
          writeContract: async (transaction) => {
            setWagerPhase('signing');
            const signature = await wallet.writeContract(transaction);
            setWagerPhase('confirming');
            return signature;
          },
        });
        sessionStorage.setItem('chess_matchmaking_game', gameId);
        sessionStorage.setItem('chess_player_name_v1', playerDisplayName);
        navigate(`/game/${gameId}`);
        return;
      }

      const joined = await joinPvpLobby(lobby.id);
      sessionStorage.setItem('chess_matchmaking_game', joined.gameId);
      sessionStorage.setItem('chess_player_name_v1', playerDisplayName);
      navigate(`/game/${joined.gameId}`);
    } catch (err) {
      const message = wagerEntryErrorMessage(err);
      if (lobby.matchType === 'wager') {
        setWagerError(message);
      } else {
        setCreateError('LOBBY EXPIRED OR WAS TAKEN. REFRESH AND TRY AGAIN.');
      }
      await refreshLobbies({ quiet: true });
    } finally {
      setPendingLobbyId(null);
    }
  };

  const handleCreateLobby = async () => {
    playMenuSelect();
    setCreateError(null);
    setWagerError(null);
    setLobbyCopyError(null);
    setPvpEntryMode(lobbyMatchType === 'wager' ? 'wager' : 'practice');

    if (!isSupabaseConfigured && !isLocalHost()) {
      setCreateError('ONLINE PLAY IS NOT CONFIGURED YET. TRY VS CPU.');
      setWagerPhase('idle');
      return;
    }

    if (lobbyMatchType === 'wager' && lobbyWagerBlocker) {
      setWagerError(lobbyWagerBlocker);
      setWagerPhase('failed');
      return;
    }

    setMatching(true);
    try {
      const preparedGameId = lobbyMatchType === 'wager'
        ? await hostWagerLobbyGame(lobbyStakeLamports, lobbyFormat.timeControl)
        : undefined;
      const created = await createPvpLobby({
        name: cleanLobbyName(lobbyName, playerDisplayName),
        hostName: playerDisplayName,
        matchType: lobbyMatchType,
        access: lobbyMatchType === 'wager' ? lobbyAccess : lobbyAccess === 'holder' ? 'open' : lobbyAccess,
        color: 'random',
        timeControl: lobbyFormat.timeControl,
        gameId: preparedGameId,
        stakeRaw: lobbyMatchType === 'wager' ? lobbyStakeLamports.toString() : undefined,
        stakeLabel: lobbyMatchType === 'wager' ? lobbyStakeLabel : undefined,
        assetSymbol: lobbyMatchType === 'wager' ? wagerConfig.asset.symbol : undefined,
      });
      await refreshLobbies({ quiet: true });
      try {
        await copyTextToClipboard(lobbyInviteUrl(created.gameId, lobbyMatchType === 'wager' ? lobbyStakeLamports.toString() : null));
        setCopiedLobbyGameId(created.gameId);
      } catch (copyErr) {
        console.error('Failed to copy lobby invite after create', copyErr);
      }
      if (lobbyMatchType === 'wager') setWagerPhase('queued');
      sessionStorage.setItem('chess_matchmaking_game', created.gameId);
      sessionStorage.setItem('chess_player_name_v1', playerDisplayName);
      navigate(`/game/${created.gameId}`);
    } catch (err) {
      setWagerPhase('failed');
      const message = wagerEntryErrorMessage(err);
      if (lobbyMatchType === 'wager') {
        setWagerError(message);
      } else {
        console.error('Failed to create lobby', err);
        setCreateError('LOBBY COULD NOT START. CHECK CONNECTION AND TRY AGAIN.');
      }
      setMatching(false);
    }
  };

  const handleStart = async () => {
    playMenuSelect();
    setCreateError(null);
    if (mode === 'pvp') {
      setWagerError(null);
      if (!isSupabaseConfigured && !isLocalHost()) {
        setCreateError('ONLINE PLAY IS NOT CONFIGURED YET. TRY VS CPU.');
        setWagerPhase('idle');
        return;
      }
      setMatching(true);
      try {
        if (pvpEntryMode === 'wager') {
          if (wagerBlocker) throw new Error(wagerBlocker);
          const gameId = await enterWagerGame(selectedStakeLamports, quickFormat.timeControl);
          setWagerPhase('queued');
          sessionStorage.setItem('chess_matchmaking_game', gameId);
          sessionStorage.setItem('chess_player_name_v1', playerDisplayName);
          navigate(`/game/${gameId}`);
          return;
        }

        const gameId = await joinPvpQueue(quickFormat.timeControl);
        sessionStorage.setItem('chess_matchmaking_game', gameId);
        sessionStorage.setItem('chess_player_name_v1', playerDisplayName);
        navigate(`/game/${gameId}`);
      } catch (err) {
        setWagerPhase('failed');
        const message = wagerEntryErrorMessage(err);
        if (pvpEntryMode === 'practice') {
          console.error('Failed to create online game', err);
          setCreateError('ONLINE GAME COULD NOT START. CHECK CONNECTION AND TRY AGAIN.');
        } else {
          setWagerError(message);
        }
        setMatching(false);
      }
    } else {
      const localGameConfig = { mode, difficulty, soundEnabled: soundOn, cpuCharacter, playerName: playerDisplayName };
      saveLocalGameConfig(localGameConfig);
      navigate('/game', { state: localGameConfig });
    }
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    saveAudioPreferences({ sfxOn: next });
    if (next) playMenuClick();
  };

  if (screen === 'press-start') {
    return <SkyClubLobby
      mode={mode} entry={wagersEnabled ? pvpEntryMode : 'practice'} difficulty={difficulty}
      format={quickFormatId} stake={selectedStakeLamports} stakes={wagerConfig.presetStakeLamports}
      wagersEnabled={wagersEnabled} wallet={wallet} busy={matching}
      phase={phaseLabel(wagerPhase)} error={createError || wagerError} blocker={wagerBlocker}
      onMode={(nextMode, entry) => { setMode(nextMode); setPvpEntryMode(entry); setCreateError(null); setWagerError(null); }}
      onDifficulty={setDifficulty} onFormat={setQuickFormatId} onStake={setSelectedStakeLamports}
      onPlay={() => void handleStart()}
      onFriends={() => {
        setMode('pvp'); setMenuTab('play'); setShowOptions(false);
        setOnlinePanelMode('create'); setLobbyAccess('invite'); setLobbyFormatId(quickFormatId);
        setLobbyMatchType(wagersEnabled && pvpEntryMode === 'wager' ? 'wager' : 'free');
        handlePressStart();
      }}
      onLeaderboard={() => { setMenuTab('leaderboard'); setShowOptions(false); handlePressStart(); }}
      onSettings={() => { setMenuTab('play'); setShowOptions(true); handlePressStart(); }}
    />;
  }

  return (
    <div className={`blox-menu min-h-screen relative overflow-hidden ${mode === 'pvp' ? 'blox-menu-online' : ''}`}>
      <div className="blox-menu-world">
      {/* 3D Background on menu too */}
      <Suspense fallback={<div className="absolute inset-0 bg-background" />}>
        <TitleChessScene />
      </Suspense>
      </div>
      <div className="blox-menu-top"><button className="blox-back" onClick={() => { setScreen('press-start'); setShowOptions(false); playMenuClick(); }}><ArrowLeft size={18}/> BACK TO ISLAND</button><a href="/funds" className="blox-back">MY FUNDS</a><span><Crown size={18}/> CHESSBLOX</span></div>

      <div className="relative z-20 menu-screen-scroll p-4">
        <div className={`retro-slide-up main-menu-stack max-w-md w-full ${mode === 'pvp' ? 'is-pvp-wide' : ''}`}>
          <div className="blox-menu-heading">
            <p className="blox-eyebrow">YOUR NEXT GREAT MOVE</p>
            <h1>{showOptions ? 'Make it yours.' : menuTab === 'leaderboard' ? 'The best on the block.' : 'Choose your challenge.'}</h1>
            <p>{showOptions ? 'A little tuning before the next big move.' : 'Set your board. Find your rival. Take the crown.'}</p>
          </div>

          <div className="lobby-panel-tabs main-menu-tabs mb-4">
            <button
              className={`retro-btn retro-btn-small ${menuTab === 'play' ? 'retro-selected' : ''}`}
              onClick={() => {
                setMenuTab('play');
                playMenuClick();
              }}
            >
              <Swords size={17}/> PLAY
            </button>
            <button
              className={`retro-btn retro-btn-small ${menuTab === 'leaderboard' ? 'retro-selected' : ''}`}
              onClick={() => {
                setMenuTab('leaderboard');
                setShowOptions(false);
                playMenuClick();
              }}
            >
              <Trophy size={17}/> LEADERBOARD
            </button>
          </div>

          {menuTab === 'leaderboard' ? (
            <CpuLeaderboardPanel
              available={isSupabaseConfigured}
              entries={cpuLeaderboardEntries}
              loading={cpuLeaderboardLoading}
              error={cpuLeaderboardError}
              onRefresh={() => void refreshCpuLeaderboard()}
            />
          ) : !showOptions ? (
            <div className={`menu-main-content ${mode === 'pvp' ? 'is-pvp-dashboard' : ''}`}>
              <div className="menu-side-column">
                <details className="retro-panel launch-ca-panel p-4" aria-label="Launch contract address"><summary>Token information</summary>
                  <div className="launch-ca-header">
                    <span>LAUNCH CA</span>
                    <span>{launchTokenSymbol.toUpperCase()}</span>
                  </div>
                  <div className="launch-ca-row">
                    <button
                      type="button"
                      className={`launch-ca-value ${hasLaunchContractAddress ? '' : 'is-empty'}`}
                      onClick={handleCopyContractAddress}
                      disabled={!hasLaunchContractAddress || contractCopyState === 'copying'}
                      aria-label={hasLaunchContractAddress ? 'Copy launch contract address' : 'Launch contract address pending'}
                    >
                      {hasLaunchContractAddress ? launchContractAddress : 'CA TBA'}
                    </button>
                    <button
                      type="button"
                      className="retro-btn retro-btn-small launch-ca-copy-btn"
                      onClick={handleCopyContractAddress}
                      disabled={!hasLaunchContractAddress || contractCopyState === 'copying'}
                    >
                      {contractCopyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      <span>{contractCopyButtonText}</span>
                    </button>
                  </div>
                  <p className={`launch-ca-status ${contractCopyState === 'failed' ? 'is-error' : ''}`} aria-live="polite">
                    {contractCopyStatus}
                  </p>
                </details>

                {/* Mode selection */}
                <div className="retro-panel p-4">
                  <p className="text-[9px] font-retro text-muted-foreground mb-3 text-center">
                    SELECT MODE
                  </p>
                  <div className="flex gap-3 justify-center">
                    <button
                      className={`retro-btn retro-btn-small ${mode === 'pvp' ? 'retro-selected' : ''}`}
                      onClick={() => { setMode('pvp'); setCreateError(null); setWagerError(null); playMenuClick(); }}
                    >
                      PVP
                    </button>
                    <button
                      className={`retro-btn retro-btn-small ${mode === 'cpu' ? 'retro-selected' : ''}`}
                      onClick={() => { setMode('cpu'); setCreateError(null); setWagerError(null); playMenuClick(); }}
                    >
                      VS CPU
                    </button>
                  </div>
                </div>

                {mode === 'pvp' && <details className="retro-panel blox-wallet p-4" open={pvpEntryMode === 'wager' || lobbyMatchType === 'wager'}><summary>Wallet & wagers</summary><WalletStatusPanel wallet={wallet} /></details>}

                {mode === 'cpu' && (
                  <details className="retro-panel blox-rewards p-4 space-y-3"><summary>CPU rewards & wallet</summary>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[9px] font-retro text-muted-foreground">CPU REWARDS</p>
                      <span className={`text-[7px] font-retro ${wallet.address ? 'text-primary' : 'text-muted-foreground'}`}>
                        {wallet.shortAddress ?? 'NO WALLET'}
                      </span>
                    </div>
                    <p className="text-[7px] leading-4 text-muted-foreground">
                      CONNECT A WALLET TO RECEIVE AUTOMATIC CA TOKEN PAYOUTS AFTER VERIFIED CPU CHECKMATES.
                    </p>
                    {!wallet.address ? (
                      <button
                        className="retro-btn retro-btn-small flex w-full items-center justify-center gap-2"
                        onClick={() => void wallet.connect()}
                        disabled={wallet.connecting}
                      >
                        <Wallet size={14} aria-hidden="true" />
                        {wallet.connecting ? 'CONNECTING...' : 'CONNECT WALLET'}
                      </button>
                    ) : (
                      <button
                        className="retro-btn retro-btn-small flex w-full items-center justify-center gap-2"
                        onClick={() => void wallet.disconnect()}
                      >
                        <Unplug size={14} aria-hidden="true" />
                        DISCONNECT
                      </button>
                    )}
                    {wallet.error && (
                      <p className="text-[7px] leading-4 text-destructive">{wallet.error}</p>
                    )}
                  </details>
                )}

                {/* Character selection (CPU only) */}
                {mode === 'cpu' && (
                  <div className="retro-panel p-4">
                    <p className="text-[9px] font-retro text-muted-foreground mb-3 text-center">
                      SELECT OPPONENT
                    </p>
                    <div className="flex gap-3 justify-center">
                      <button
                        className={`retro-btn retro-btn-small flex flex-col items-center gap-1 px-4 py-2 ${cpuCharacter === 'ivan' ? 'retro-selected' : ''}`}
                        onClick={() => { setCpuCharacter('ivan'); playMenuClick(); }}
                      >
                        <span>BLOX BARON</span>
                        <span className="text-[6px] text-muted-foreground">Block Strategist</span>
                      </button>
                      <button
                        className={`retro-btn retro-btn-small flex flex-col items-center gap-1 px-4 py-2 ${cpuCharacter === 'vinnie' ? 'retro-selected' : ''}`}
                        onClick={() => { setCpuCharacter('vinnie'); playMenuClick(); }}
                      >
                        <span>ROOK RANGER</span>
                        <span className="text-[6px] text-muted-foreground">Sky Island Champion</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Difficulty (CPU only) */}
                {mode === 'cpu' && (
                  <div className="retro-panel p-4">
                    <p className="text-[9px] font-retro text-muted-foreground mb-3 text-center">
                      CPU DIFFICULTY
                    </p>
                    <div className="flex gap-2 justify-center">
                      {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => (
                        <button
                          key={d}
                          className={`retro-btn retro-btn-small flex min-w-[96px] flex-col items-center gap-1 px-4 py-2 ${difficulty === d ? 'retro-selected' : ''}`}
                          onClick={() => { setDifficulty(d); playMenuClick(); }}
                        >
                          <span>{d.toUpperCase()}</span>
                          <span className="text-[6px] text-muted-foreground">
                            {formatCpuChessReward(cpuDifficultyPoints(d))} POINTS
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="menu-primary-column">

              {/* PvP lobbies */}
              {mode === 'pvp' && (
                <div className="retro-panel lobby-panel p-4 space-y-3">
                  <div className="lobby-panel-heading">
                    <p>ONLINE PLAY</p>
                    <span>{lobbiesLoading ? 'SYNC...' : `${filteredLobbies.length} READY`}</span>
                  </div>
                  <label className="player-tag-field">
                    <span>PLAYER TAG</span>
                    <input
                      className="retro-input"
                      value={playerName}
                      onChange={(event) => setPlayerName(normalizePlayerNameInput(event.target.value))}
                      onBlur={() => setPlayerName(playerDisplayName)}
                      maxLength={14}
                      aria-label="Player tag"
                    />
                  </label>

                  <div className="lobby-panel-tabs">
                    <button
                      className={`retro-btn retro-btn-small ${onlinePanelMode === 'lobbies' ? 'retro-selected' : ''}`}
                      onClick={() => { setOnlinePanelMode('lobbies'); setCreateError(null); setWagerError(null); playMenuClick(); }}
                    >
                      QUICK PLAY
                    </button>
                    <button
                      className={`retro-btn retro-btn-small ${onlinePanelMode === 'create' ? 'retro-selected' : ''}`}
                      onClick={() => { setOnlinePanelMode('create'); setCreateError(null); setWagerError(null); playMenuClick(); }}
                    >
                      CUSTOM
                    </button>
                  </div>

                  {onlinePanelMode === 'lobbies' ? (
                    <div className="lobby-browse-layout">
                      <div className="lobby-match-setup">
                        <div className="lobby-subhead">
                          <span>QUICK PLAY</span>
                          <span>{quickFormat.label.toUpperCase()}</span>
                        </div>

                        <div className="lobby-control-group">
                          <span>MODE</span>
                          <div className="lobby-choice-row">
                            <button
                              className={`retro-btn retro-btn-small ${pvpEntryMode === 'practice' ? 'retro-selected' : ''}`}
                              onClick={() => { setPvpEntryMode('practice'); setWagerPhase('idle'); setWagerError(null); setCreateError(null); playMenuClick(); }}
                            >
                              FREE
                            </button>
                            <button
                              className={`retro-btn retro-btn-small ${pvpEntryMode === 'wager' ? 'retro-selected' : ''}`}
                              onClick={() => { setPvpEntryMode('wager'); setWagerPhase('idle'); setWagerError(null); setCreateError(null); playMenuClick(); }}
                            >
                              WAGER
                            </button>
                          </div>
                        </div>

                        <div className="lobby-control-group">
                          <span>FORMAT</span>
                          <div className="lobby-format-family-grid" aria-label="Quick match format">
                            {formatFamilies.map((family) => (
                              <div className="lobby-format-family" key={family}>
                                <span>{chessFormatFamilyLabel(family)}</span>
                                <div className="lobby-format-row">
                                  {CHESS_TIME_CONTROL_FORMATS.filter((format) => format.family === family).map((format) => {
                                    const formatQueueCopy = queueCopyFor(queuePlayersFor(quickMatchType, format.timeControl, selectedQueueStakeRaw));
                                    return (
                                      <button
                                        key={format.id}
                                        className={`retro-btn retro-btn-small ${quickFormatId === format.id ? 'retro-selected' : ''}`}
                                        onClick={() => { setQuickFormatId(format.id); setWagerPhase('idle'); setCreateError(null); setWagerError(null); playMenuClick(); }}
                                      >
                                        <span>{format.timeControl}</span>
                                        {formatQueueCopy && <small className="lobby-format-queue">{formatQueueCopy}</small>}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {selectedQueueCopy && (
                          <p className="lobby-queue-count">
                            {selectedQueueCopy}
                          </p>
                        )}

                        {pvpEntryMode === 'wager' && (
                          <div className="lobby-wager-setup">
                            <div className="flex flex-wrap items-center justify-center gap-2">
                              {wallet.address ? (
                                <>
                                  <button
                                    className="retro-btn retro-btn-small"
                                    onClick={() => {
                                      void wallet.refreshBalance();
                                      void wagerHoldBalance.refresh();
                                    }}
                                  >
                                    {wallet.refreshing || wagerHoldBalance.refreshing
                                      ? 'BAL...'
                                      : `${wallet.shortAddress} • ${wallet.balanceEth?.toFixed(4) ?? '--'} ETH • ${wagerClusterLabel}`}
                                  </button>
                                  <button className="retro-btn retro-btn-small" onClick={wallet.disconnect}>
                                    DISCONNECT
                                  </button>
                                </>
                              ) : (
                                <button className="retro-btn retro-btn-small" onClick={wallet.connect} disabled={wallet.connecting}>
                                  {wallet.connecting ? 'CONNECTING...' : 'CONNECT WALLET'}
                                </button>
                              )}
                            </div>

                            <div className="lobby-stake-row">
                              {wagerConfig.presetStakeLamports.map((stake) => (
                                <button
                                  key={stake.toString()}
                                  className={`retro-btn retro-btn-small ${selectedStakeLamports === stake ? 'retro-selected' : ''}`}
                                  onClick={() => { setSelectedStakeLamports(stake); setWagerPhase('idle'); playMenuClick(); }}
                                >
                                  {formatRawAmount(stake, wagerConfig.asset.decimals)} {wagerConfig.asset.symbol}
                                </button>
                              ))}
                            </div>

                            <div className="lobby-wager-status">
                              <div>
                                {wagerCostCopy.map((line) => (
                                  <p key={line}>{line}</p>
                                ))}
                              </div>
                              {wagerConfig.holdGate.enabled && wallet.address && (
                                <p>
                                  CA: {wagerHoldBalance.loading ? 'LOADING' : `${holdBalanceLabel} ${wagerConfig.holdGate.symbol}`} / {holdRequiredLabel} {wagerConfig.holdGate.symbol}
                                </p>
                              )}
                              <p>
                                CAP: {formatRawAmount(wagerConfig.maxStakeLamports, wagerConfig.asset.decimals)} {wagerConfig.asset.symbol} • {wagerClusterLabel}
                              </p>
                              <p className={wagerBlocker ? 'is-error' : 'is-ready'}>
                                {wagerBlocker ?? `${wagerStart.label} • ESCROW READY`}
                              </p>
                              {(wagerError || wallet.error) && (
                                <p className="is-error">{wagerError || wallet.error}</p>
                              )}
                              <a href="/funds" className="underline">Recover a payment, claim winnings, or get a refund →</a>
                            </div>
                          </div>
                        )}
                      </div>

                      <details className="lobby-directory-column"><summary>Browse custom lobbies</summary>
                        <div className="lobby-subhead">
                          <span>CUSTOM LOBBIES</span>
                          <span>{lobbyFilter.toUpperCase()}</span>
                        </div>
                        <div className="lobby-filter-row">
                          {(['all', 'free', 'wager'] as LobbyFilter[]).map((filter) => (
                            <button
                              key={filter}
                              className={`retro-btn retro-btn-small ${lobbyFilter === filter ? 'retro-selected' : ''}`}
                              onClick={() => { setLobbyFilter(filter); playMenuClick(); }}
                            >
                              {filter.toUpperCase()}
                            </button>
                          ))}
                        </div>

                        <div className="lobby-list" aria-label="Saved lobbies">
                          {filteredLobbies.length === 0 ? (
                            <div className="lobby-empty-state">
                              <span>{lobbyDirectoryError ?? 'NO WAITING LOBBIES LIVE'}</span>
                            </div>
                          ) : (
                            filteredLobbies.map((lobby) => (
                              <div className="lobby-card" key={lobby.id}>
                                <div className="lobby-card-main">
                                  <div className="lobby-card-title-row">
                                    <p>{lobby.name}</p>
                                    <span className={`lobby-badge is-${lobby.matchType}`}>
                                      {lobby.matchType === 'free' ? 'FREE' : lobby.stakeLabel ?? 'WAGER'}
                                    </span>
                                  </div>
                                  <p className="lobby-card-meta">
                                    {lobby.hostName} • {lobby.formatLabel ?? chessFormatByTimeControl(lobby.timeControl).label} • {lobby.access.toUpperCase()} • HOST WHITE
                                  </p>
                                </div>
                                <div className="lobby-card-actions">
                                  <button
                                    className="retro-btn retro-btn-small"
                                    onClick={() => void handleOpenLobby(lobby)}
                                    disabled={pendingLobbyId === lobby.id}
                                  >
                                    {pendingLobbyId === lobby.id ? 'JOIN...' : lobby.matchType === 'wager' ? 'WAGER' : 'JOIN'}
                                  </button>
                                  <button
                                    className="retro-btn retro-btn-small lobby-copy-btn"
                                    onClick={() => void handleCopyLobbyInvite(lobby)}
                                  >
                                    {copiedLobbyGameId === lobby.gameId ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                                    <span>{copiedLobbyGameId === lobby.gameId ? 'COPIED' : 'COPY'}</span>
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                        {lobbyDirectoryError && filteredLobbies.length > 0 && (
                          <p className="text-[7px] text-destructive text-center font-retro">
                            {lobbyDirectoryError}
                          </p>
                        )}
                      </details>
                    </div>
                  ) : (
                    <>
                      <div className="lobby-subhead">
                        <span>CUSTOM LOBBY</span>
                        <span>{lobbyMatchType.toUpperCase()}</span>
                      </div>
                      <label className="lobby-form-field">
                        <span>LOBBY NAME</span>
                        <input
                          className="retro-input"
                          value={lobbyName}
                          onChange={(event) => setLobbyName(event.target.value.slice(0, 24))}
                          onBlur={() => setLobbyName(cleanLobbyName(lobbyName, playerDisplayName))}
                          maxLength={24}
                          aria-label="Lobby name"
                        />
                      </label>

                      <div className="lobby-create-grid">
                        <div className="lobby-form-field">
                          <span>TYPE</span>
                          <div className="lobby-choice-row">
                            <button
                              className={`retro-btn retro-btn-small ${lobbyMatchType === 'free' ? 'retro-selected' : ''}`}
                              onClick={() => {
                                setLobbyMatchType('free');
                                setPvpEntryMode('practice');
                                if (lobbyAccess === 'holder') setLobbyAccess('open');
                                setCreateError(null);
                                setWagerError(null);
                                playMenuClick();
                              }}
                            >
                              FREE
                            </button>
                            <button
                              className={`retro-btn retro-btn-small ${lobbyMatchType === 'wager' ? 'retro-selected' : ''}`}
                              onClick={() => {
                                setLobbyMatchType('wager');
                                setPvpEntryMode('wager');
                                setCreateError(null);
                                setWagerError(null);
                                playMenuClick();
                              }}
                            >
                              WAGER
                            </button>
                          </div>
                        </div>

                        <div className="lobby-form-field">
                          <span>ACCESS</span>
                          <div className="lobby-choice-row">
                            {(['open', 'invite', 'holder'] as PvpLobbyAccess[]).map((access) => {
                              const disabled = lobbyMatchType === 'free' && access === 'holder';
                              return (
                                <button
                                  key={access}
                                  className={`retro-btn retro-btn-small ${lobbyAccess === access ? 'retro-selected' : ''}`}
                                  onClick={() => { setLobbyAccess(access); setCreateError(null); playMenuClick(); }}
                                  disabled={disabled}
                                >
                                  {access === 'open' ? 'OPEN' : access === 'invite' ? 'INVITE' : 'HOLDER'}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="lobby-form-field is-wide">
                          <span>FORMAT</span>
                          <div className="lobby-format-family-grid" aria-label="Lobby format">
                            {formatFamilies.map((family) => (
                              <div className="lobby-format-family" key={family}>
                                <span>{chessFormatFamilyLabel(family)}</span>
                                <div className="lobby-format-row">
                                  {CHESS_TIME_CONTROL_FORMATS.filter((format) => format.family === family).map((format) => (
                                    <button
                                      key={format.id}
                                      className={`retro-btn retro-btn-small ${lobbyFormatId === format.id ? 'retro-selected' : ''}`}
                                      onClick={() => { setLobbyFormatId(format.id); setCreateError(null); setWagerError(null); playMenuClick(); }}
                                    >
                                      <span>{format.timeControl}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                      </div>

                      {lobbyMatchType === 'wager' && (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center justify-center gap-2">
                            {wallet.address ? (
                              <>
                                <button
                                  className="retro-btn retro-btn-small"
                                  onClick={() => {
                                    void wallet.refreshBalance();
                                    void wagerHoldBalance.refresh();
                                  }}
                                >
                                  {wallet.refreshing || wagerHoldBalance.refreshing
                                    ? 'BAL...'
                                    : `${wallet.shortAddress} • ${wallet.balanceEth?.toFixed(4) ?? '--'} ETH • ${wagerClusterLabel}`}
                                </button>
                                <button className="retro-btn retro-btn-small" onClick={wallet.disconnect}>
                                  DISCONNECT
                                </button>
                              </>
                            ) : (
                              <button className="retro-btn retro-btn-small" onClick={wallet.connect} disabled={wallet.connecting}>
                                {wallet.connecting ? 'CONNECTING...' : 'CONNECT WALLET'}
                              </button>
                            )}
                          </div>

                          <div className="lobby-stake-row">
                            {wagerConfig.presetStakeLamports.map((stake) => (
                              <button
                                key={stake.toString()}
                                className={`retro-btn retro-btn-small ${lobbyStakeMode === 'preset' && selectedStakeLamports === stake ? 'retro-selected' : ''}`}
                                onClick={() => {
                                  setLobbyStakeMode('preset');
                                  setSelectedStakeLamports(stake);
                                  setWagerPhase('idle');
                                  setWagerError(null);
                                  playMenuClick();
                                }}
                              >
                                {formatRawAmount(stake, wagerConfig.asset.decimals)} {wagerConfig.asset.symbol}
                              </button>
                            ))}
                          </div>

                          <label className="lobby-form-field">
                            <span>CUSTOM</span>
                            <div className="lobby-custom-wager">
                              <input
                                className="retro-input"
                                value={customStakeAmount}
                                onChange={(event) => {
                                  setLobbyStakeMode('custom');
                                  setCustomStakeAmount(event.target.value.replace(/[^0-9.]/g, '').slice(0, 14));
                                  setWagerPhase('idle');
                                  setWagerError(null);
                                }}
                                placeholder={`0.05 ${wagerConfig.asset.symbol}`}
                                aria-label="Custom wager amount"
                              />
                              <button
                                className={`retro-btn retro-btn-small ${lobbyStakeMode === 'custom' ? 'retro-selected' : ''}`}
                                onClick={() => { setLobbyStakeMode('custom'); playMenuClick(); }}
                              >
                                USE
                              </button>
                            </div>
                          </label>

                          <div className="space-y-1 text-center font-retro">
                            <div className="border border-primary/30 bg-background/40 px-3 py-2 text-left">
                              {lobbyWagerCostCopy.map((line) => (
                                <p key={line} className="text-[7px] leading-4 text-foreground">
                                  {line}
                                </p>
                              ))}
                            </div>
                            {wagerConfig.holdGate.enabled && wallet.address && (
                              <p className="text-[7px] text-muted-foreground">
                                CA: {wagerHoldBalance.loading ? 'LOADING' : `${holdBalanceLabel} ${wagerConfig.holdGate.symbol}`} / {holdRequiredLabel} {wagerConfig.holdGate.symbol}
                              </p>
                            )}
                            <p className="text-[7px] text-muted-foreground">
                              CAP: {formatRawAmount(wagerConfig.maxStakeLamports, wagerConfig.asset.decimals)} {wagerConfig.asset.symbol} • {wagerClusterLabel}
                            </p>
                            <p className={`text-[7px] ${lobbyWagerBlocker ? 'text-destructive' : 'text-primary'}`}>
                              {lobbyWagerBlocker ?? `${lobbyWagerStart.label} • ESCROW READY`}
                            </p>
                            {(wagerError || wallet.error) && (
                              <p className="text-[7px] text-destructive">{wagerError || wallet.error}</p>
                            )}
                          </div>
                        </div>
                      )}

                      <button
                        className="retro-btn retro-btn-gold lobby-create-button"
                        onClick={handleCreateLobby}
                        disabled={matching || (lobbyMatchType === 'wager' && !!lobbyWagerBlocker)}
                      >
                        {matching
                          ? lobbyMatchType === 'wager' ? phaseLabel(wagerPhase) : 'CREATING...'
                          : 'CREATE + COPY INVITE'}
                      </button>
                    </>
                  )}

                  {lobbyCopyError && (
                    <p className="text-[7px] text-destructive text-center font-retro">
                      {lobbyCopyError}
                    </p>
                  )}

                </div>
              )}

              {/* Start button */}
              {showPrimaryStartButton && (
                <div className="text-center pt-2">
                  <button
                    className="retro-btn retro-btn-gold"
                    onClick={handleStart}
                    disabled={matching || (mode === 'pvp' && pvpEntryMode === 'wager' && !!wagerBlocker)}
                  >
                    {matching
                      ? pvpEntryMode === 'wager' ? phaseLabel(wagerPhase) : 'MATCHING...'
                      : mode === 'pvp' ? 'QUICK MATCH' : 'START GAME'}
                  </button>
                </div>
              )}
              {createError && (
                <p className="menu-error-text" role="alert">
                  {createError}
                </p>
              )}

              {/* Options & Sound */}
              <div className="flex justify-center gap-3 pt-2">
                <button
                  className="retro-btn retro-btn-small"
                  onClick={() => { setShowOptions(true); playMenuClick(); }}
                >
                  OPTIONS
                </button>
                <button
                  className="retro-btn retro-btn-small"
                  onClick={toggleSound}
                >
                  SOUND: {soundOn ? 'ON' : 'OFF'}
                </button>
              </div>
              </div>
            </div>
          ) : (
            /* Options Panel */
            <div className="retro-panel p-6 space-y-4">
              <p className="text-[10px] font-retro text-primary text-center retro-glow">
                OPTIONS
              </p>
              <div className="space-y-3 text-[8px] font-retro text-foreground">
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span>SOUND FX</span>
                  <button onClick={toggleSound} className="text-primary">
                    {soundOn ? '● ON' : '○ OFF'}
                  </button>
                </div>
                {themesEnabled && (
                  <div className="options-theme-row py-2 border-b border-border/30">
                    <span>THEME</span>
                    <ThemeSelector compact />
                  </div>
                )}
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span>CAMERA</span>
                  <span className="text-muted-foreground">DRAG TO ORBIT</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span>PIECES</span>
                  <span className="text-muted-foreground">DRAG OR CLICK</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span>BOARD</span>
                  <span className="text-muted-foreground">CLASSIC 8 × 8</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span>VERSION</span>
                  <span className="text-muted-foreground">SKY ISLANDS</span>
                </div>
              </div>
              <div className="text-center pt-2">
                <button
                  className="retro-btn retro-btn-small"
                  onClick={() => { setShowOptions(false); playMenuClick(); }}
                >
                  BACK
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="text-center mt-8">
            <p className="text-muted-foreground text-[6px] tracking-wider">
              CHESSBLOX • THE SKY ISLANDS
            </p>
            <p className="text-muted-foreground text-[6px] mt-1 tracking-wider">
              A NEW PERSPECTIVE ON A CLASSIC GAME
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
