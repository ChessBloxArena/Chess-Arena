import { useAutomaticPayoutReview } from "@/components/AutomaticPayoutReview";
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatEther } from 'viem';
import { useRobinhoodWallet } from '@/hooks/useRobinhoodWallet';
import { joinRobinhoodWagerPvpLobby } from '@/hooks/useOnlinePvp';
import { getWagerConfig } from '@/lib/wagerConfig';
import { getWagerStartBlocker } from '@/lib/wagerMatchmaking';
import { robinhoodEscrowAddress } from '@/lib/robinhoodChain';
import { parseWagerInviteStake } from '@/lib/wagerInvite';

export default function WagerJoin() {
  const reviewPayout = useAutomaticPayoutReview();
  const { gameId } = useParams<{ gameId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const wallet = useRobinhoodWallet();
  const config = getWagerConfig();
  const stake = parseWagerInviteStake(params.get('stake'));
  const validInvite = !!gameId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(gameId) && stake !== null;
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const blocker = !validInvite ? 'This wager invite is incomplete. Ask the host for a new link.' : getWagerStartBlocker({
    walletConnected: !!wallet.address,
    balanceLamports: wallet.balanceWei,
    stakeLamports: stake!,
    maxStakeLamports: config.maxStakeLamports,
    newWagersEnabled: config.newWagersEnabled,
    realEscrowEnabled: config.realEscrowEnabled && !!robinhoodEscrowAddress(),
    paymentMode: config.paymentMode,
  });
  const join = async () => {
    if (inFlight.current || blocker || !gameId || !wallet.address || stake === null) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try {
      const joinedId = await joinRobinhoodWagerPvpLobby(gameId, {
        address: wallet.address, stakeWei: stake, reviewPayout,
        signMessage: wallet.signMessage, writeContract: wallet.writeContract,
      });
      navigate(`/game/${joinedId}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to join this wager.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return <main className="min-h-screen bg-background px-5 py-8 text-foreground">
    <div className="mx-auto max-w-xl space-y-6">
      <nav className="flex justify-between gap-4"><Link to="/" className="text-primary">← ChessBlox</Link><Link to="/funds" className="text-primary">My funds</Link></nav>
      <header><h1 className="text-3xl font-bold">You've been challenged.</h1><p className="mt-2 text-muted-foreground">Join an ETH wager on Robinhood Chain.</p></header>
      <section className="rounded-xl border border-primary/30 bg-card p-5 space-y-4">
        {validInvite && <><p>Your stake <strong className="float-right">{formatEther(stake!)} ETH</strong></p><p>Winner's pot <strong className="float-right">{formatEther(stake! * 2n)} ETH</strong></p><p className="text-sm text-muted-foreground">Payout terms are checked before your deposit. Draws return each player's stake. Deposit network fees are separate.</p></>}
        <p className="text-sm text-muted-foreground">{wallet.address ? `${wallet.shortAddress} · ${wallet.balanceWei === null ? 'Checking balance…' : `${formatEther(wallet.balanceWei)} ETH`}` : 'Connect an EVM wallet to join.'}</p>
        {!wallet.address && validInvite ? <button className="retro-btn w-full" disabled={wallet.connecting} onClick={() => void wallet.connect()}>{wallet.connecting ? 'Connecting…' : 'Connect wallet'}</button>
          : <button className="retro-btn retro-btn-gold w-full" disabled={busy || !!blocker} onClick={() => void join()}>{busy ? 'Confirm in wallet…' : validInvite ? `Deposit ${formatEther(stake!)} ETH & join` : 'Invite unavailable'}</button>}
        {blocker && <p className="text-sm text-muted-foreground">{blocker}</p>}
        {(error || wallet.error) && <p role="alert" className="break-words text-sm text-destructive">{error || wallet.error}</p>}
        <p className="text-sm text-muted-foreground">Joining asks for proof of wallet ownership, then a separate deposit. The match stake is checked before any payment is requested.</p>
      </section>
      <Link to="/funds" className="block text-primary underline">Already paid? Recover your match or funds →</Link>
    </div>
  </main>;
}
