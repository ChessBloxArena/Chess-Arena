import { translateText, localize, useLanguage } from '@/lib/i18n';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { ArrowLeft, ArrowRight, Check, CheckCheck, Coins, Crown, Gem, ShieldCheck, Swords, Trophy, Wallet, X } from 'lucide-react';
import ChessScene from '@/components/ChessScene';
import { buildMoveFeedback, type MoveFeedback } from '@/lib/moveFeedback';
import { INITIAL_PREVIEW, previewWalletReducer } from '@/lib/wagerPreview';
import { CAPTURE_DURATION } from '@/lib/captureMotion';
import { PUSH_DURATION } from '@/lib/pushMotion';
import { playMoveSound, playCaptureSound, playGameOverSound } from '@/lib/sounds';
import '@/wager-preview.css';

const OPENING = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];
const HINTS = ['e2 → e4', 'd1 → h5', 'f1 → c4', 'h5 → f7'];
const ETH = (n: number) => n.toFixed(3);
export default function WagerPreview() {
  useLanguage();
  const [wallet, dispatch] = useReducer(previewWalletReducer, INITIAL_PREVIEW);
  const chess = useRef(new Chess());
  const [fen, setFen] = useState(chess.current.fen());
  const [selected, setSelected] = useState<Square | null>(null);
  const [feedback, setFeedback] = useState<MoveFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [authorization, setAuthorization] = useState<'fund' | 'claim' | 'convert' | null>(null);
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionInFlight = useRef(false);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const game = chess.current;
  const board = game.board();
  const history = game.history();
  const legal = selected ? game.moves({ square: selected, verbose: true }).map(move => move.to) : [];
  const pot = wallet.stake * 2;
  const finished = ['won','claimed','converted'].includes(wallet.step);
  const stage = ['setup','funded'].includes(wallet.step) ? 0 : wallet.step === 'playing' ? 1 : wallet.step === 'won' ? 2 : wallet.step === 'claimed' ? 3 : 4;
  function applyMove(san: string) {
    const move = game.move(san);
    setFeedback(buildMoveFeedback(game, move));
    setFen(game.fen());
    if (move.captured) playCaptureSound(); else playMoveSound();
  }
  function selectSquare(square: Square) {
    if (wallet.step !== 'playing' || busy || game.turn() !== 'w') return;
    if (selected && legal.includes(square)) {
      const move = game.moves({ square:selected, verbose:true }).find(move => move.to === square);
      if (move?.san !== OPENING[history.length]) { setNote(`Follow this opening: ${HINTS[Math.floor(history.length / 2)]}.`); setSelected(null); return; }
      applyMove(move.san); setSelected(null); setNote(''); setBusy(true);
      timer.current = setTimeout(() => {
        if (game.isCheckmate()) { dispatch({type:'win'}); setBusy(false); playGameOverSound(); return; }
        applyMove(OPENING[game.history().length]);
        timer.current = setTimeout(() => setBusy(false), PUSH_DURATION * 1000 + 100);
      }, (move.captured ? CAPTURE_DURATION : PUSH_DURATION) * 1000 + 600);
    } else { setSelected(game.get(square)?.color === 'w' ? square : null); setNote(''); }
  }
  function authorize() {
    if (!authorization || actionInFlight.current) return;
    const action = authorization;
    actionInFlight.current = true; setBusy(true);
    timer.current = setTimeout(() => {
      dispatch({type:action}); setAuthorization(null); setBusy(false); actionInFlight.current = false;
    }, 1500);
  }
  function reset() {
    if (timer.current) clearTimeout(timer.current);
    chess.current = new Chess(); setFen(chess.current.fen()); setSelected(null); setFeedback(null); setBusy(false); setNote(''); dispatch({type:'reset'});
  }
  return <main className="wager-world">
    <header className="wager-header">
      <a href="/" className="blox-brand"><span className="blox-brand-icon"><Crown size={24}/></span><span>{translateText("CHESS")}<span>{translateText("BLOX")}</span></span></a>
      <nav aria-label={translateText("Wager progress")}>{localize(['MATCH','PLAY','WIN','CLAIM','RBLX'].map((label,i)=><span key={label} className={i===stage?'current':i<stage?'done':''}>{localize(i<stage?<Check size={13}/>:<i>{localize(i+1)}</i>)}{localize(label)}</span>))}</nav>
      <span className="simulation-badge">{translateText("SIMULATED TRANSACTIONS")}</span>
    </header>
    <section className="wager-layout">
      <aside className="wager-sidebar">
        <a href="/" className="wager-back"><ArrowLeft size={14}/>{translateText(" THE BLOCK EXCHANGE")}</a>
        <div className="wager-wallet"><span><Wallet size={16}/>{translateText(" YOUR WALLET")}</span><strong>{localize(ETH(wallet.eth))} <small>{translateText("ETH")}</small></strong>{localize(wallet.rblx>0&&<b>+{localize(wallet.rblx.toFixed(3))}{translateText(" RBLX")}</b>)}</div>
        <div className="wager-card">
          <p className="wager-kicker">{localize(finished?'THE CROWN IS YOURS':'YOUR NEXT BIG MOVE')}</p>
          <h1>{localize(wallet.step==='converted'?'Victory, collected.':wallet.step==='claimed'?'Make your next move.':wallet.step==='won'?'You won the pot.':wallet.step==='playing'?'Build your victory.':'Put your skills on the board.')}</h1>
          <p className="wager-description">{localize(wallet.step==='converted'?'Your ETH pot has become RBLX in this walkthrough.':wallet.step==='claimed'?'Keep your ETH, or convert the claimed pot into RBLX.':wallet.step==='won'?'Checkmate. Claim the full match pot into your wallet.':wallet.step==='playing'?'Your crew moves the pieces. You make the decisions.':'Choose your stake. Both players contribute equally. The winner claims the full pot.')}</p>
          {localize(wallet.step==='setup'&&<><label className="wager-field-label">{translateText("YOUR STAKE")}</label><div className="stake-options">{localize([.005,.01,.025].map(stake=><button key={stake} className={wallet.stake===stake?'active':''} onClick={()=>dispatch({type:'stake',amount:stake})}>{localize(ETH(stake))}<small>{translateText("ETH")}</small></button>))}</div></>)}
          <div className="wager-pot"><span><Coins size={18}/>{translateText(" TOTAL MATCH POT")}</span><strong>{localize(ETH(pot))} <small>{translateText("ETH")}</small></strong><p>{translateText("Your ")}{localize(ETH(wallet.stake))}{translateText(" + rival’s ")}{localize(ETH(wallet.stake))}</p></div>
          <div className="wager-breakdown"><span>{translateText("Your stake ")}<strong>{localize(ETH(wallet.stake))}{translateText(" ETH")}</strong></span><span>{localize(finished?'Your profit':'Profit if you win')} <strong className="mint">+{localize(ETH(wallet.stake))}{translateText(" ETH")}</strong></span><small>{translateText("Profit before network and conversion fees.")}</small></div>
          {localize(wallet.step==='setup'&&<button className="wager-primary" onClick={()=>setAuthorization('fund')}><ShieldCheck size={18}/>{translateText(" LOCK IN STAKE ")}<ArrowRight size={18}/></button>)}
          {localize(wallet.step==='funded'&&<><div className="wager-confirmed"><CheckCheck size={19}/>{translateText(" Both stakes locked · ")}{localize(ETH(pot))}{translateText(" ETH")}</div><button className="wager-primary" onClick={()=>dispatch({type:'play'})}><Swords size={18}/>{translateText(" ENTER MATCH ")}<ArrowRight size={18}/></button></>)}
          {localize(wallet.step==='playing'&&<div className="wager-hint"><span>{localize(busy?'CREW IN MOTION':'YOUR NEXT MOVE')}</span><strong>{localize(busy?'Give your crew a moment…':HINTS[Math.floor(history.length/2)])}</strong><p>{localize(note||'A classic seven-ply checkmate opening.')}</p></div>)}
          {localize(wallet.step==='won'&&<button className="wager-primary" onClick={()=>setAuthorization('claim')}><Trophy size={18}/>{translateText(" CLAIM ")}{localize(ETH(pot))}{translateText(" ETH ")}<ArrowRight size={18}/></button>)}
          {localize(wallet.step==='claimed'&&<><div className="wager-confirmed"><CheckCheck size={18}/> {localize(ETH(pot))}{translateText(" ETH added to wallet")}</div><button className="wager-primary purple" onClick={()=>setAuthorization('convert')}><Gem size={18}/>{translateText(" CONVERT POT TO RBLX ")}<ArrowRight size={18}/></button><p className="wager-footnote">{translateText("Optional. Live conversion requires regional and wallet eligibility, a current quote, and a separate wallet transaction.")}</p></>)}
          {localize(wallet.step==='converted'&&<><div className="rblx-receipt"><span className="rblx-symbol">◇</span><div><small>{translateText("RECEIVED IN WALKTHROUGH")}</small><strong>{localize(wallet.rblx.toFixed(3))}{translateText(" RBLX")}</strong><span>{translateText("Roblox · Robinhood Stock Token")}</span></div></div><button className="wager-primary" onClick={reset}>{translateText("PLAY AGAIN ")}<ArrowRight size={18}/></button></>)}
        </div>
        <p className="wager-asset-note">{translateText("RBLX is a tokenized debt security tracking Roblox, not Robux or Roblox shares. ")}<a href="https://docs.robinhood.com/chain/stock-tokens/" target="_blank" rel="noreferrer">{translateText("About Stock Tokens ↗")}</a></p>
      </aside>
      <div className="wager-arena">
        <div className="wager-match-heading"><span className="wager-crew-chip">{translateText("◆ YOUR BLOCK CREW")}</span><div><small>{translateText("SKY ISLANDS · CLASSIC CHESS")}</small><h2>{translateText("YOU ")}<span>{translateText("vs")}</span>{translateText(" BLOX BARON")}</h2></div><span className="wager-crew-chip purple">{translateText("◇ BARON’S CREW")}</span></div>
        <div className="wager-chess" data-fen={fen}><ChessScene board={board} selectedSquare={selected} legalMoves={legal} highlightedSquares={feedback?[feedback.from,feedback.to]:[]} onSquareClick={selectSquare} moveFeedback={feedback} cpuMode cpuThinking={busy&&!finished}/></div>
        {localize(finished&&<div className="wager-victory"><Trophy size={24}/><div><strong>{translateText("CHECKMATE. NICE BUILD.")}</strong><span>+{localize(ETH(wallet.stake))}{translateText(" ETH profit before fees")}</span></div><CheckCheck size={21}/></div>)}
        <div className="wager-moves"><div><span className="wager-status-dot"/>{localize(finished?'YOU WIN':wallet.step==='playing'?(busy?'CREW IN MOTION':'YOUR MOVE'):'CREWS READY')}</div><span>{localize(history.length?history.map((san,i)=>`${i%2===0?Math.floor(i/2)+1+'. ':''}${san}`).join('  '):'32 pieces. Two crews. One crown.')}</span></div>
      </div>
    </section>
    {localize(authorization&&<div className="wager-modal-shade"><section className="wager-authorization" role="dialog" aria-modal="true" aria-labelledby="authorization-title"><button className="authorization-close" aria-label={translateText("Close authorization")} disabled={busy} onClick={()=>setAuthorization(null)}><X size={20}/></button><div className="authorization-icon">{localize(authorization==='convert'?<Gem size={30}/>:<Wallet size={30}/>)}</div><p className="wager-kicker">{translateText("CHESSBLOX WALLET · SIMULATION")}</p><h2 id="authorization-title">{localize(authorization==='fund'?'Authorize your stake':authorization==='claim'?'Claim your winnings':'ETH → RBLX')}</h2><p>{localize(authorization==='fund'?'Your stake joins an equal rival contribution.':authorization==='claim'?'The full match pot returns to your wallet.':'Convert the claimed pot with a separate wallet authorization.')}</p><div className="authorization-amount">{localize(authorization==='fund'?ETH(wallet.stake):ETH(pot))} <small>{translateText("ETH")}</small></div>{localize(authorization==='convert'&&<div className="conversion-quote"><ArrowRight size={20}/><strong>{localize((pot*50).toFixed(3))}{translateText(" RBLX")}</strong><span>{translateText("Illustrative rate: 1 ETH = 50 RBLX")}<br/>{translateText("Fees excluded; live quotes vary.")}</span></div>)}<div className="authorization-detail"><span>{translateText("Destination")}</span><strong>{localize(authorization==='fund'?'Match escrow':authorization==='claim'?'Your wallet':'Your RBLX balance')}</strong></div><button className="wager-primary" disabled={busy} onClick={authorize}>{localize(busy?'PROCESSING…':authorization==='convert'?'AUTHORIZE CONVERSION':authorization==='claim'?'AUTHORIZE CLAIM':'AUTHORIZE STAKE')} {localize(!busy&&<ArrowRight size={18}/>)}</button></section></div>)}
  </main>;
}
