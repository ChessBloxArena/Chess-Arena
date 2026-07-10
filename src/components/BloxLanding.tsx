import { automaticRblxPayoutEnabled, rblxConversionEnabled } from "@/lib/robinhoodChain";
import { Crown, Swords, Trophy, Settings2, ArrowRight, Globe2, MousePointer2, Box, Volume2, VolumeX } from 'lucide-react';
import { lazy, Suspense } from 'react';
const TitleChessScene = lazy(() => import('./TitleChessScene'));
interface Props {
  wagersEnabled: boolean;
  onPlay: (mode: 'cpu' | 'pvp') => void;
  onLeaderboard: () => void;
  onSettings: () => void;
  soundOn: boolean;
  onSound: () => void;
}
export default function BloxLanding({ wagersEnabled, onPlay, onLeaderboard, onSettings, soundOn, onSound }: Props) {
  return <main className="blox-home">
    <div className="blox-home-world" aria-label="Floating block-built chess island"><Suspense fallback={<div className="blox-world-loading">Building your world…</div>}><TitleChessScene /></Suspense></div>
    <header className="blox-header">
      <a className="blox-brand" href="/" aria-label="ChessBlox home"><span className="blox-brand-icon"><Crown size={25} strokeWidth={2.8}/></span><span>CHESS<span>BLOX</span></span></a>
      <div className="blox-header-right"><a href="/funds" className="text-sm font-bold">MY FUNDS</a><span className="blox-edition"><Box size={14}/> THE ONCHAIN ISLANDS</span><button className="blox-icon-button" onClick={onSound} aria-label={soundOn ? 'Mute sound' : 'Enable sound'}>{soundOn ? <Volume2 size={19}/> : <VolumeX size={19}/>}</button><button className="blox-icon-button" onClick={onSettings} aria-label="Settings"><Settings2 size={19}/></button></div>
    </header>
    <section className="blox-home-copy">
      <p className="blox-eyebrow"><span/> BIG MOVES. LITTLE BLOCKS.</p>
      <h1 className="blox-title">CHESS<span>BLOX<span className="blox-title-period">.</span></span></h1>
      <p className="blox-tagline">Big brain. Block crew. Your next move starts here.</p>
      <div className="blox-home-actions">
        <button className="blox-play" onClick={()=>onPlay('pvp')}><Swords size={27} strokeWidth={2.7}/><span>{wagersEnabled ? 'PLAY FOR ETH' : 'LET’S PLAY'}<small>{wagersEnabled ? 'Choose your stake. Find your rival.' : 'Find your next rival'}</small></span><ArrowRight size={23}/></button>
        <div className="blox-secondary-actions"><button onClick={()=>onPlay('cpu')}><Crown size={19}/> VS COMPUTER</button><button onClick={onLeaderboard}><Trophy size={18}/> LEADERBOARD</button></div>
      </div>
      <div className="blox-crypto-strip"><span>◆ ETH</span><i>→</i><span>♜ PLAY</span><i>→</i><span>◇ {rblxConversionEnabled() ? "RBLX" : "ETH"}</span></div>
      <div className="blox-home-note"><Globe2 size={15}/><span>{automaticRblxPayoutEnabled() ? "ETH match pots. Automatic RBLX prizes." : rblxConversionEnabled() ? "ETH match pots. Optional RBLX conversion." : "Play for ETH. Claim your winnings to your wallet."}</span></div>
    </section>
    <div className="blox-world-caption"><span className="blox-world-number">01</span><span><small>YOUR BATTLEGROUND</small><strong>The Block Exchange</strong></span><span className="blox-world-tag">CLASSIC 8 × 8</span></div>
    {import.meta.env.DEV && <a className="blox-tour-link" href="/wager-preview">Explore the wager flow ↗</a>}
    <footer className="blox-home-footer"><span>32 PIECES. INFINITE POSSIBILITIES.</span><span><MousePointer2 size={13}/> SELECT · MOVE · CONQUER</span><span>CHESSBLOX © 2026</span></footer>
  </main>;
}
