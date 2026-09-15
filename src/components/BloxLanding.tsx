import { translateText, localize, useLanguage } from '@/lib/i18n';
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
  useLanguage();
  return <main className="blox-home">
    <div className="blox-home-world" aria-label={translateText("Floating block-built chess island")}><Suspense fallback={<div className="blox-world-loading">{translateText("Building your world…")}</div>}><TitleChessScene /></Suspense></div>
    <header className="blox-header">
      <a className="blox-brand" href="/" aria-label={translateText("ChessBlox home")}><span className="blox-brand-icon"><Crown size={25} strokeWidth={2.8}/></span><span>{translateText("CHESS")}<span>{translateText("BLOX")}</span></span></a>
      <div className="blox-header-right"><a href="/funds" className="text-sm font-bold">{translateText("MY FUNDS")}</a><span className="blox-edition"><Box size={14}/>{translateText(" THE ONCHAIN ISLANDS")}</span><button className="blox-icon-button" onClick={onSound} aria-label={localize(soundOn ? 'Mute sound' : 'Enable sound')}>{localize(soundOn ? <Volume2 size={19}/> : <VolumeX size={19}/>)}</button><button className="blox-icon-button" onClick={onSettings} aria-label={translateText("Settings")}><Settings2 size={19}/></button></div>
    </header>
    <section className="blox-home-copy">
      <p className="blox-eyebrow"><span/>{translateText(" BIG MOVES. LITTLE BLOCKS.")}</p>
      <h1 className="blox-title">{translateText("CHESS")}<span>{translateText("BLOX")}<span className="blox-title-period">.</span></span></h1>
      <p className="blox-tagline">{translateText("Big brain. Block crew. Your next move starts here.")}</p>
      <div className="blox-home-actions">
        <button className="blox-play" onClick={()=>onPlay('pvp')}><Swords size={27} strokeWidth={2.7}/><span>{localize(wagersEnabled ? 'PLAY FOR ETH' : 'LET’S PLAY')}<small>{localize(wagersEnabled ? 'Choose your stake. Find your rival.' : 'Find your next rival')}</small></span><ArrowRight size={23}/></button>
        <div className="blox-secondary-actions"><button onClick={()=>onPlay('cpu')}><Crown size={19}/>{translateText(" VS COMPUTER")}</button><button onClick={onLeaderboard}><Trophy size={18}/>{translateText(" LEADERBOARD")}</button></div>
      </div>
      <div className="blox-crypto-strip"><span>{translateText("◆ ETH")}</span><i>→</i><span>{translateText("♜ PLAY")}</span><i>→</i><span>◇ {localize(rblxConversionEnabled() ? "RBLX" : "ETH")}</span></div>
      <div className="blox-home-note"><Globe2 size={15}/><span>{localize(automaticRblxPayoutEnabled() ? "ETH match pots. Automatic RBLX prizes." : rblxConversionEnabled() ? "ETH match pots. Optional RBLX conversion." : "Play for ETH. Claim your winnings to your wallet.")}</span></div>
    </section>
    <div className="blox-world-caption"><span className="blox-world-number">01</span><span><small>{translateText("YOUR BATTLEGROUND")}</small><strong>{translateText("The Block Exchange")}</strong></span><span className="blox-world-tag">{translateText("CLASSIC 8 × 8")}</span></div>
    {localize(import.meta.env.DEV && <a className="blox-tour-link" href="/wager-preview">{translateText("Explore the wager flow ↗")}</a>)}
    <footer className="blox-home-footer"><span>{translateText("32 PIECES. INFINITE POSSIBILITIES.")}</span><span><MousePointer2 size={13}/>{translateText(" SELECT · MOVE · CONQUER")}</span><span>{translateText("CHESSBLOX © 2026")}</span></footer>
  </main>;
}
