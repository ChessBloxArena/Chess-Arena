// Local component fixture. Wallet methods never reach a provider or network.
import { rememberPlayConsent, PLAY_TERMS_VERSION } from '../../src/lib/playConsent';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ArenaThemeProvider } from '../../src/components/ArenaThemeProvider';
import { RblxEstimateValue } from '../../src/components/RblxEstimate';
import SkyClubLobby from '../../src/components/SkyClubLobby';
import { AutomaticPayoutReview } from '../../src/components/AutomaticPayoutReview';
import type { RobinhoodWallet } from '../../src/hooks/useRobinhoodWallet';
import type { GameMode, Difficulty } from '../../src/hooks/useChessGame';
import type { ChessFormatId } from '../../src/lib/chessFormats';
import type { AutomaticPayoutQuote } from '../../src/lib/automaticRblx';
import '../../src/index.css';
import '../../src/blox.css';
import '../../src/sky-club.css';
const walletAddress = '0x2222222222222222222222222222222222222222' as const;
const unavailable = async ():Promise<never> => { throw new Error('Verification fixture: wallet actions are disabled.'); };
const wallet:RobinhoodWallet = {address:walletAddress,shortAddress:'0x2222…2222',balanceWei:100000000000000000n,balanceEth:.1,connecting:false,refreshing:false,error:null,connect:unavailable,disconnect:unavailable,refreshBalance:unavailable,signMessage:unavailable,writeContract:unavailable,sendTransaction:unavailable};
function Fixture() {
  const [mode,setMode]=useState<GameMode>('pvp'),[entry,setEntry]=useState<'wager'|'practice'>('wager'),[difficulty,setDifficulty]=useState<Difficulty>('medium');
  const [format,setFormat]=useState<ChessFormatId>('blitz_5_0'),[stake,setStake]=useState(25000000000000000n),[review,setReview]=useState(false);
  const quote:AutomaticPayoutQuote={version:1,chainId:4663,escrowAddress:'0x1111111111111111111111111111111111111111',walletAddress,stakeWei:stake.toString(),minimumRblxOut:'2897000000000000000',quotedRblxOut:'2927000000000000000',expiresAt:new Date(Date.now()+90000).toISOString(),fallbackSeconds:900,token:'local-fixture-only',payoutMode:'automatic_rblx'};
  return <><SkyClubLobby automaticPayout payoutPreview={<RblxEstimateValue quote={quote}/>} mode={mode} entry={entry} difficulty={difficulty} format={format} stake={stake} stakes={[25000000000000000n,30000000000000000n,35000000000000000n,40000000000000000n,45000000000000000n,50000000000000000n,100000000000000000n]} wagersEnabled wallet={wallet} busy={false} phase="" error={null} blocker={null} onMode={(m,e)=>{setMode(m);setEntry(e);}} onDifficulty={setDifficulty} onFormat={setFormat} onStake={setStake} onPlay={()=>setReview(true)} onFriends={()=>{}} onSettings={()=>{}} onLeaderboard={()=>{}}/>{review && <AutomaticPayoutReview request={{walletAddress,stakeWei:stake,signMessage:unavailable}} onComplete={()=>setReview(false)} onCancel={()=>setReview(false)} loadQuote={async()=>{rememberPlayConsent(walletAddress,PLAY_TERMS_VERSION,new Date().toISOString());return quote;}}/>}</>;
}
if(import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<MemoryRouter><ArenaThemeProvider><Fixture/></ArenaThemeProvider></MemoryRouter>);
