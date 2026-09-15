import { translateText, localize, useLanguage } from '@/lib/i18n';
import LanguageToggle from './LanguageToggle';
import { readPlayConsent } from '@/lib/playConsent';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import PlayTermsText from './PlayTermsText';
import RblxEstimate from './RblxEstimate';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Box, Check, ChevronDown, Clock3, Crown, Settings2, ShieldCheck, Swords, Trophy, Users, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CHESS_TIME_CONTROL_FORMATS, type ChessFormatId } from '@/lib/chessFormats';
import { formatEther } from 'viem';
import type { Difficulty, GameMode } from '@/hooks/useChessGame';
import type { RobinhoodWallet } from '@/hooks/useRobinhoodWallet';
import { automaticRblxPayoutEnabled, rblxConversionEnabled } from '@/lib/robinhoodChain';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';

const TitleChessScene = lazy(() => import('./TitleChessScene'));
interface Props {
  mode: GameMode; entry: 'practice' | 'wager'; difficulty: Difficulty;
  format: ChessFormatId; stake: bigint; stakes: bigint[]; wagersEnabled: boolean;
  wallet: RobinhoodWallet; busy: boolean; phase: string; error: string | null; blocker: string | null;
  automaticPayout?: boolean; payoutPreview?: ReactNode;
  onMode: (mode: GameMode, entry: 'practice' | 'wager') => void;
  onDifficulty: (difficulty: Difficulty) => void; onFormat: (format: ChessFormatId) => void;
  onStake: (stake: bigint) => void; onPlay: () => void;
  onFriends: () => void; onSettings: () => void; onLeaderboard: () => void;
}
export default function SkyClubLobby(p: Props) {
  useLanguage();
  const [details, setDetails] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [consent, setConsent] = useState(() => p.wallet.address ? readPlayConsent(p.wallet.address) : null);
  useEffect(() => {
    const update = () => setConsent(p.wallet.address ? readPlayConsent(p.wallet.address) : null);
    update(); window.addEventListener('chessblox-consent-change', update);
    return () => window.removeEventListener('chessblox-consent-change', update);
  }, [p.wallet.address]);
  const wager = p.mode === 'pvp' && p.entry === 'wager';
  const automatic = p.automaticPayout ?? automaticRblxPayoutEnabled();
  const stake = formatEther(p.stake);
  const chips = p.stakes.slice(0, 3);
  const needsWallet = wager && !p.wallet.address;
  const start = () => { if (needsWallet) void p.wallet.connect(); else p.onPlay(); };
  return <main className="sky-club">
    <section className="sky-rail" aria-label={translateText("Quick play setup")}>
      <Link className="sky-brand" to="/" aria-label={translateText("ChessBlox home")}><span className="sky-brand-icon"><Crown size={30} strokeWidth={2.4}/></span><span>{translateText("CHESS")}<strong>{translateText("BLOX")}</strong></span></Link>
      <div className="sky-setup">
        <p className="sky-eyebrow">{translateText("QUICK PLAY")}</p>
        <h1>{translateText("Your next")}<br/><span>{translateText("move.")}</span></h1>
        <div className="sky-mode" aria-label={translateText("Match type")}>
          <button aria-pressed={!wager} disabled={p.busy} onClick={() => p.onMode(p.mode, 'practice')}>{translateText("Practice")}</button>
          <button aria-pressed={wager} disabled={p.busy || !p.wagersEnabled} onClick={() => p.onMode('pvp', 'wager')}><Swords size={16}/>{translateText(" Wager")}</button>
        </div>
        {localize(!wager && <label className="sky-select"><Users size={17}/><select aria-label={translateText("Opponent")} value={p.mode} disabled={p.busy} onChange={e => p.onMode(e.target.value as GameMode, 'practice')}><option value="pvp">{translateText("Online opponent")}</option><option value="cpu">{translateText("Computer")}</option></select><ChevronDown size={17}/></label>)}
        {localize(p.mode === 'cpu' ? <label className="sky-select"><Crown size={17}/><select aria-label={translateText("Difficulty")} value={p.difficulty} disabled={p.busy} onChange={e => p.onDifficulty(e.target.value as Difficulty)}><option value="easy">{translateText("Easy · find your feet")}</option><option value="medium">{translateText("Medium · a good challenge")}</option><option value="hard">{translateText("Hard · bring your best")}</option></select><ChevronDown size={17}/></label> : <label className="sky-select"><Clock3 size={17}/><select aria-label={translateText("Time control")} value={p.format} disabled={p.busy} onChange={e => p.onFormat(e.target.value as ChessFormatId)}>{localize(CHESS_TIME_CONTROL_FORMATS.map(f => <option key={f.id} value={f.id}>{localize(f.label.split(' ')[0])} · {localize(f.baseMinutes)}{translateText(" min")}{localize(f.incrementSeconds ? ` + ${f.incrementSeconds}s` : '')}</option>))}</select><ChevronDown size={17}/></label>)}
        {localize(wager ? <>
          <div className="sky-stake-label"><span>{translateText("Your stake")}</span>{localize(p.stakes.length > 3 ? <DropdownMenu><DropdownMenuTrigger asChild><button disabled={p.busy} aria-label={translateText("More stake amounts")}>{translateText("ETH ")}<ChevronDown size={13}/></button></DropdownMenuTrigger><DropdownMenuContent className="sky-dropdown" align="end">{localize(p.stakes.map(s => <DropdownMenuItem key={s.toString()} onSelect={() => p.onStake(s)}>{localize(formatEther(s))}{translateText(" ETH ")}{localize(p.stake === s && <Check size={14} className="ml-auto"/>)}</DropdownMenuItem>))}</DropdownMenuContent></DropdownMenu> : <span>{translateText("ETH")}</span>)}</div>
          <div className="sky-stakes">{localize(chips.map(s => <button key={s.toString()} aria-pressed={s === p.stake} disabled={p.busy} onClick={() => p.onStake(s)}>{localize(formatEther(s))}</button>))}</div>
          <div className="sky-prize"><div><span>{translateText("Winner’s pot")}</span><strong>{localize(formatEther(p.stake * 2n))} <small>{translateText("ETH")}</small></strong></div>{localize(automatic ? p.payoutPreview ?? (p.wallet.address ? <RblxEstimate key={`${p.wallet.address}:${p.stake}`} request={{ walletAddress: p.wallet.address, stakeWei: p.stake, signMessage: p.wallet.signMessage }}/> : <p>{translateText("RBLX Stock Tokens, sent to your wallet.")}</p>) : <p>{localize(rblxConversionEnabled() ? 'Claim ETH. Convert to RBLX after your win.' : 'Win the match. Claim the pot.')}</p>)}</div>
        </> : <div className="sky-practice-note"><Crown size={23}/><div><strong>{localize(p.mode === 'cpu' ? 'A little practice. A big next move.' : 'Find your next great rival.')}</strong><p>{localize(p.mode === 'cpu' ? 'No wallet needed. Just you and the board.' : 'A free match with another player.')}</p></div></div>)}
        <div className="sky-launch">
          <button className="sky-play" disabled={p.busy || p.wallet.connecting || (wager && !needsWallet && !!p.blocker)} onClick={start}><span>{localize(p.busy ? p.phase || 'Finding your rival…' : p.wallet.connecting ? 'Connecting…' : needsWallet ? 'Connect wallet to play' : wager ? `Confirm ${stake} ETH & play` : p.mode === 'cpu' ? 'Play computer' : 'Find a match')}</span><ArrowRight size={21}/></button>
          <p className="sky-launch-note">{localize(wager ? <><ShieldCheck size={13}/>{translateText(" You approve the deposit in your wallet.")}</> : <><Check size={13}/>{translateText(" Your preferences are saved for next time.")}</>)}</p>
          {localize((p.error || p.wallet.error || (wager && !needsWallet && p.blocker)) && <p role="alert" className="sky-error">{localize(p.error || p.wallet.error || p.blocker)}</p>)}
          {localize(wager && <button className="sky-text-button" onClick={() => setDetails(!details)} aria-expanded={details}>{translateText("Match terms & fees")}</button>)}
          {localize(details && wager && <div className="sky-terms-detail">{translateText("Both players deposit the same stake. Draws and cancelled matches return ETH. Your wallet shows deposit network fees. ")}{localize(automatic ? 'Before entry, review your RBLX minimum and the 15-minute ETH fallback. Stock Token eligibility and Uniswap terms apply.' : 'The winner claims ETH; optional RBLX conversion requires an eligible wallet and a separate swap approval.')}</div>)}
        </div>
      </div>
      <footer className="sky-rail-footer">{localize(consent && <div className="sky-consent-status"><Check size={14}/>{translateText(" Terms accepted ")}<button onClick={() => setTermsOpen(true)}>{translateText("Review")}</button></div>)}<button onClick={p.onFriends} disabled={p.busy}><Users size={17}/>{translateText(" Play with a friend ")}<ArrowRight size={16}/></button><button onClick={p.onLeaderboard}><Trophy size={16}/>{translateText(" Leaderboard")}</button></footer>
    </section>
    <section className="sky-world" aria-label={translateText("Floating chess island")}><Suspense fallback={<div className="sky-loading">{translateText("Setting the board…")}</div>}><TitleChessScene/></Suspense>
      <header className="sky-world-header"><LanguageToggle/><DropdownMenu><DropdownMenuTrigger asChild><button className="sky-wallet"><Wallet size={16}/>{localize(p.wallet.address ? p.wallet.balanceWei === null ? p.wallet.shortAddress : `${Number(formatEther(p.wallet.balanceWei)).toLocaleString(undefined, {minimumFractionDigits:3,maximumFractionDigits:3})} ETH` : 'Your wallet')}<ChevronDown size={14}/></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="sky-dropdown">{localize(p.wallet.address ? <><div className="px-3 py-2 text-xs">{p.wallet.shortAddress}</div><div className="px-3 py-2 text-sm">{localize(p.wallet.balanceWei === null ? 'Loading balance…' : `${formatEther(p.wallet.balanceWei)} ETH`)}</div><DropdownMenuItem asChild><Link to="/funds">{translateText("My funds & payouts")}</Link></DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem onSelect={() => void p.wallet.disconnect()}>{translateText("Disconnect")}</DropdownMenuItem></> : <DropdownMenuItem onSelect={() => void p.wallet.connect()}>{translateText("Connect wallet")}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu><button className="sky-settings" onClick={p.onSettings} aria-label={translateText("Settings")}><Settings2 size={20}/></button></header>
      <div className="sky-world-caption"><Box size={17}/><span>{translateText("The Block Exchange")}</span></div>
    </section>
    <Dialog open={termsOpen} onOpenChange={setTermsOpen}><DialogContent className="play-review max-h-[90dvh] overflow-y-auto"><DialogTitle>{translateText("Your play terms")}</DialogTitle><DialogDescription>{translateText("Saved for this wallet. You review the exact amount for each paid match.")}</DialogDescription><div className="play-review-body"><PlayTermsText/></div><button className="sky-play" onClick={() => setTermsOpen(false)}>{translateText("Back to the board")}</button></DialogContent></Dialog>
  </main>;
}
