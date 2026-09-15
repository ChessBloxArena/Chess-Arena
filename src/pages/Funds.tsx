import { walletErrorMessage } from '@/lib/walletError';
import LanguageToggle from '@/components/LanguageToggle';
import { translateText, localize, useLanguage, getLanguage } from '@/lib/i18n';
import { automaticRblxAbi } from "../../supabase/functions/_shared/automaticRblx.mjs";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPublicClient, formatEther, http, type Hash } from "viem";
import { useRobinhoodWallet } from "@/hooks/useRobinhoodWallet";
import { saveRobinhoodWagerCredential, joinRobinhoodWagerPvpQueue } from "@/hooks/useOnlinePvp";
import { invokeWagerReferee, signWalletProof } from "@/lib/wagerRefereeClient";
import { robinhoodChain, robinhoodChessEscrowAbi, robinhoodContestKey, robinhoodEscrowAddress, robinhoodEntryEscrowAddress, automaticRobinhoodEscrowAddress, gameEscrowAddress, robinhoodTransactionUrl } from "@/lib/robinhoodChain";
import { clearPendingRobinhoodWager, readPendingRobinhoodWager, type PendingRobinhoodWager } from "@/lib/robinhoodPendingWager";

const client = createPublicClient({ chain: robinhoodChain, transport: http() });
interface SavedGame {
  gameId: string;
  contestId: string;
  color: "w" | "b";
  stakeWei: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
  escrowAddress?: string;
  payoutMode?: string;
  payoutStatus?: string;
  payoutSignature?: string;
  payoutAmount?: string;
}
type Contest = Awaited<ReturnType<typeof readContest>>;
async function readContest(contestId: string, escrowAddress?: string) {
  const address = gameEscrowAddress(escrowAddress);
  if (!address) throw new Error("Escrow is not configured.");
  const contest = await client.readContract({ address, abi: robinhoodChessEscrowAbi, functionName: "getContest", args: [robinhoodContestKey(contestId)] });
  const payout = address.toLowerCase() === automaticRobinhoodEscrowAddress()?.toLowerCase() ? await client.readContract({ address, abi: automaticRblxAbi, functionName: "getPayout", args: [robinhoodContestKey(contestId)] }) : null;
  return { ...contest, payout };

}

export default function Funds() {
  useLanguage();
  const wallet = useRobinhoodWallet();
  const navigate = useNavigate();
  const activeWallet = useRef(wallet.address);
  activeWallet.current = wallet.address;
  const actionInFlight = useRef(false);
  const [games, setGames] = useState<SavedGame[]>([]);
  const [contests, setContests] = useState<Record<string, Contest>>({});
  const [pending, setPending] = useState<PendingRobinhoodWager | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Hash | null>(null);
  useEffect(() => {
    setGames([]); setContests({}); setLoaded(false); setNextCursor(null); setReceipt(null);
    try {
      const escrow = robinhoodEntryEscrowAddress();
      setPending(wallet.address && escrow ? (readPendingRobinhoodWager(escrow, wallet.address) ?? (robinhoodEscrowAddress() && readPendingRobinhoodWager(robinhoodEscrowAddress()!, wallet.address))) : null);
    } catch (err) { setError(err instanceof Error ? err.message : "Saved payment could not be read."); }
  }, [wallet.address]);

  const run = async (action: () => Promise<void>) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true); setError(null);
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : "Please try again."); }
    finally { actionInFlight.current = false; setBusy(false); }
  };
  const load = async (before?: string) => {
    if (!wallet.address) throw new Error("Connect your wallet first.");
    const requestedWallet = wallet.address;
    const proof = await signWalletProof({ action: "list_robinhood_games", walletAddress: wallet.address, signMessage: wallet.signMessage });
    const result = await invokeWagerReferee<{ games: SavedGame[]; nextCursor: string | null }>({ action: "list_robinhood_games", walletAddress: wallet.address, before, ...proof });
    if (activeWallet.current !== requestedWallet) return;
    setGames((previous) => before ? [...previous, ...result.games] : result.games);
    setNextCursor(result.nextCursor); setLoaded(true);
    const snapshots: Record<string, Contest> = {};
    for (let i = 0; i < result.games.length; i += 5) {
      await Promise.all(result.games.slice(i, i + 5).map(async (game) => {
        snapshots[game.gameId] = await readContest(game.contestId, game.escrowAddress);
      }));
    }
    if (activeWallet.current === requestedWallet) setContests((previous) => ({ ...previous, ...snapshots }));
  };
  const openGame = async (game: SavedGame) => {
    if (!wallet.address) return;
    const proof = await signWalletProof({ action: "recover_robinhood_seat", gameId: game.gameId, walletAddress: wallet.address, signMessage: wallet.signMessage });
    const result = await invokeWagerReferee<{ gameId: string; color: "w" | "b"; playerToken: string }>({ action: "recover_robinhood_seat", gameId: game.gameId, walletAddress: wallet.address, ...proof });
    saveRobinhoodWagerCredential(result);
    const escrow = gameEscrowAddress(game.escrowAddress);
    if (escrow && game.paymentStatus !== "white_prepared" && game.paymentStatus !== "black_prepared") {
      clearPendingRobinhoodWager(escrow, wallet.address, game.gameId);
    }
    navigate(`/game/${result.gameId}`);
  };
  const transact = async (game: SavedGame, functionName: "claimEth" | "cancelUnmatched" | "refundExpired") => {
    const address = gameEscrowAddress(game.escrowAddress);
    if (!address || !wallet.address) throw new Error("Connect your wallet first.");
    const hash = await wallet.writeContract({ address, abi: robinhoodChessEscrowAbi, functionName, args: [robinhoodContestKey(game.contestId)] });
    setReceipt(hash);
    if (functionName === "claimEth") {
      try {
        const key = `chessblox:receipts:robinhood_eth_escrow:${game.contestId}:${game.color}`;
        const previous = JSON.parse(window.localStorage.getItem(key) || "{}");
        window.localStorage.setItem(key, JSON.stringify({ ...previous, claim: hash }));
      } catch { /* The confirmed claim remains successful when optional receipt storage is unavailable. */ }
    }
    const fresh = await readContest(game.contestId, game.escrowAddress);
    setContests((previous) => ({ ...previous, [game.gameId]: fresh }));
    if (fresh.state === 6) {
      clearPendingRobinhoodWager(address, wallet.address, game.gameId);
      if (pending?.prepared.gameId === game.gameId) setPending(null);
    }
  };

  return <main className="account-page">
    <div className="account-shell">
      <nav className="account-nav"><Link to="/" className="account-home">{translateText("← ChessBlox")}</Link><LanguageToggle /></nav>
      <header><h1 className="text-3xl font-bold">{translateText("My funds & matches")}</h1><p className="mt-2 text-muted-foreground">{translateText("Recover a match, collect a prize, or refund a waiting wager.")}</p></header>
      <section className="account-card account-wallet">
        <p>{localize(wallet.address ? wallet.shortAddress : "Connect the wallet you used to play.")}</p>
        <p className="text-sm text-muted-foreground">{translateText("Robinhood Chain · ")}{localize(wallet.balanceWei === null ? "—" : formatEther(wallet.balanceWei))}{translateText(" ETH")}</p>
        {localize(!wallet.address ? <button className="retro-btn" disabled={wallet.connecting} onClick={() => void wallet.connect()}>{translateText("Connect wallet")}</button>
          : <button className="retro-btn" disabled={busy} onClick={() => void run(() => load())}>{localize(busy ? "Checking…" : "Find my matches")}</button>)}
        <p className="text-xs text-muted-foreground">{translateText("Finding matches asks for a signature to prove wallet ownership. Claims and refunds require a separate transaction and network fee.")}</p>
      </section>
      {localize(pending && <section className="account-card">
        <h2 className="font-bold">{translateText("Unfinished payment saved")}</h2><p>{localize(formatEther(BigInt(pending.prepared.stakeLamports)))}{translateText(" ETH · ")}{localize(pending.prepared.gameId.slice(0, 8))}</p>
        <button className="retro-btn" disabled={busy || !wallet.address} onClick={() => void run(async () => {
          if (!wallet.address) return;
          const id = await joinRobinhoodWagerPvpQueue({ ...wallet, address: wallet.address, stakeWei: BigInt(pending.prepared.stakeLamports) });
          navigate(`/game/${id}`);
        })}>{translateText("Continue saved payment")}</button>
        <p className="text-sm text-muted-foreground">{translateText("This resumes the saved match. If you already sent the transaction, it checks that payment.")}</p>
      </section>)}
      {localize((error || wallet.error) && <p role="alert" className="rounded-lg border border-destructive p-4 break-words">{localize(walletErrorMessage(error || wallet.error))}</p>)}
      {wallet.error && wallet.address && <button className="retro-btn retro-btn-small" disabled={wallet.refreshing} onClick={() => void wallet.refreshBalance()}>{translateText("Refresh ETH balance")}</button>}
      {localize(receipt && <a className="block text-primary underline break-all" href={robinhoodTransactionUrl(receipt)} target="_blank" rel="noreferrer">{translateText("Transaction confirmed ↗")}</a>)}
      {localize(loaded && games.length === 0 && <p>{translateText("No matches found for this wallet.")}</p>)}
      {localize(games.map((game) => {
        const contest = contests[game.gameId];
        const owner = wallet.address?.toLowerCase();
        const creator = contest?.creator.toLowerCase() === owner;
        const joiner = contest?.joiner.toLowerCase() === owner;
        const participant = creator || joiner;
        const fallbackReady = !contest?.payout || Number(contest.payout.settledAt) + 900 <= Date.now() / 1000;
        const claimable = contest && ((contest.state === 3 && contest.winner.toLowerCase() === owner && fallbackReady)
          || ([4, 5].includes(contest.state) && participant && !(contest.drawClaims & (creator ? 1 : 2))));
        const canCancel = contest?.state === 1 && creator;
        const canExpire = contest?.state === 2 && participant && contest.expiresAt <= BigInt(Math.floor(Date.now() / 1000));
        const title = contest?.payout?.asset === 1 ? "RBLX prize paid to wallet" : contest?.payout?.asset === 2 ? "Full ETH fallback paid" : contest?.payout && contest.state === 3 && !fallbackReady ? "Automatic RBLX payout pending" : !contest ? "Checking chain…" : contest.state === 0 ? "No deposit found" : contest.state === 1 ? "Waiting for opponent" : contest.state === 2 ? "Match funded" : contest.state === 6 ? "Funds already claimed or returned" : claimable ? "Funds ready to claim" : "Escrow settled";
        return <section key={game.gameId} className="account-card">
          <div className="account-card-heading"><h2 className="font-bold">{localize(title)}</h2><span>{localize(formatEther(BigInt(game.stakeWei)))}{translateText(" ETH stake")}</span></div>
          {localize(contest?.payout && contest.state === 3 && <p className="text-sm text-muted-foreground">{translateText("The service is processing your prize. ETH recovery unlocks ")}{localize(new Date((Number(contest.payout.settledAt) + 900) * 1000).toLocaleString(getLanguage()))}.</p>)}
          {localize(game.payoutSignature && <a className="text-primary underline" target="_blank" rel="noreferrer" href={robinhoodTransactionUrl(game.payoutSignature)}>{translateText("View payout receipt ↗")}</a>)}
          <p className="text-sm text-muted-foreground">{translateText("Match ")}{localize(game.gameId.slice(0, 8))} · {localize(new Date(game.createdAt).toLocaleString(getLanguage()))}</p>
          {localize(contest?.state === 2 && <p className="text-sm text-muted-foreground">{translateText("If settlement is unavailable, refunds unlock ")}{localize(new Date(Number(contest.expiresAt) * 1000).toLocaleString(getLanguage()))}.</p>)}
          <div className="flex flex-wrap gap-3">
            {localize(!['white_prepared', 'black_prepared'].includes(game.paymentStatus) && <button className="retro-btn retro-btn-small" disabled={busy} onClick={() => void run(() => openGame(game))}>{translateText("Open match")}</button>)}
            {localize(claimable && <button className="retro-btn retro-btn-small" disabled={busy} onClick={() => void run(() => transact(game, "claimEth"))}>{translateText("Claim ETH")}</button>)}
            {localize(canCancel && <button className="retro-btn retro-btn-small" disabled={busy} onClick={() => void run(() => transact(game, "cancelUnmatched"))}>{translateText("Refund waiting wager")}</button>)}
            {localize(canExpire && <button className="retro-btn retro-btn-small" disabled={busy} onClick={() => void run(() => transact(game, "refundExpired"))}>{translateText("Unlock refund")}</button>)}
            <button className="text-sm text-primary underline" disabled={busy} onClick={() => void run(async () => { const fresh = await readContest(game.contestId, game.escrowAddress); setContests((previous) => ({ ...previous, [game.gameId]: fresh })); })}>{translateText("Refresh status")}</button>
          </div>
        </section>;
      }))}
      {localize(nextCursor && <button disabled={busy} className="retro-btn" onClick={() => void run(() => load(nextCursor))}>{translateText("Older matches")}</button>)}
    </div>
  </main>;
}
