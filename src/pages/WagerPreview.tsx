import { useEffect, useReducer, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { ArrowLeft, ArrowRight, Check, CheckCheck, Coins, Crown, Gem, ShieldCheck, Swords, Trophy, Wallet, X } from 'lucide-react';
import ChessScene from '@/components/ChessScene';
import { buildMoveFeedback, type MoveFeedback } from '@/lib/moveFeedback';
import { INITIAL_PREVIEW, previewWalletReducer } from '@/lib/wagerPreview';
import { PUSH_DURATION } from '@/lib/pushMotion';
import { playMoveSound, playCaptureSound, playGameOverSound } from '@/lib/sounds';
import '@/wager-preview.css';

const OPENING = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];
const HINTS = ['e2 → e4', 'd1 → h5', 'f1 → c4', 'h5 → f7'];
const ETH = (n: number) => n.toFixed(3);
export default function WagerPreview() {
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
      }, PUSH_DURATION * 1000 + 600);
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
      <a href="/" className="blox-brand"><span className="blox-brand-icon"><Crown size={24}/></span><span>CHESS<span>BLOX</span></span></a>
      <nav aria-label="Wager progress">{['MATCH','PLAY','WIN','CLAIM','RBLX'].map((label,i)=><span key={label} className={i===stage?'current':i<stage?'done':''}>{i<stage?<Check size={13}/>:<i>{i+1}</i>}{label}</span>)}</nav>
      <span className="simulation-badge">SIMULATED TRANSACTIONS</span>
    </header>
    <section className="wager-layout">
      <aside className="wager-sidebar">
        <a href="/" className="wager-back"><ArrowLeft size={14}/> THE BLOCK EXCHANGE</a>
        <div className="wager-wallet"><span><Wallet size={16}/> YOUR WALLET</span><strong>{ETH(wallet.eth)} <small>ETH</small></strong>{wallet.rblx>0&&<b>+{wallet.rblx.toFixed(3)} RBLX</b>}</div>
        <div className="wager-card">
          <p className="wager-kicker">{finished?'THE CROWN IS YOURS':'YOUR NEXT BIG MOVE'}</p>
          <h1>{wallet.step==='converted'?'Victory, collected.':wallet.step==='claimed'?'Make your next move.':wallet.step==='won'?'You won the pot.':wallet.step==='playing'?'Build your victory.':'Put your skills on the board.'}</h1>
          <p className="wager-description">{wallet.step==='converted'?'Your ETH pot has become RBLX in this walkthrough.':wallet.step==='claimed'?'Keep your ETH, or convert the claimed pot into RBLX.':wallet.step==='won'?'Checkmate. Claim the full match pot into your wallet.':wallet.step==='playing'?'Your crew moves the pieces. You make the decisions.':'Choose your stake. Both players contribute equally. The winner claims the full pot.'}</p>
          {wallet.step==='setup'&&<><label className="wager-field-label">YOUR STAKE</label><div className="stake-options">{[.005,.01,.025].map(stake=><button key={stake} className={wallet.stake===stake?'active':''} onClick={()=>dispatch({type:'stake',amount:stake})}>{ETH(stake)}<small>ETH</small></button>)}</div></>}
          <div className="wager-pot"><span><Coins size={18}/> TOTAL MATCH POT</span><strong>{ETH(pot)} <small>ETH</small></strong><p>Your {ETH(wallet.stake)} + rival’s {ETH(wallet.stake)}</p></div>
          <div className="wager-breakdown"><span>Your stake <strong>{ETH(wallet.stake)} ETH</strong></span><span>{finished?'Your profit':'Profit if you win'} <strong className="mint">+{ETH(wallet.stake)} ETH</strong></span><small>Profit before network and conversion fees.</small></div>
          {wallet.step==='setup'&&<button className="wager-primary" onClick={()=>setAuthorization('fund')}><ShieldCheck size={18}/> LOCK IN STAKE <ArrowRight size={18}/></button>}
          {wallet.step==='funded'&&<><div className="wager-confirmed"><CheckCheck size={19}/> Both stakes locked · {ETH(pot)} ETH</div><button className="wager-primary" onClick={()=>dispatch({type:'play'})}><Swords size={18}/> ENTER MATCH <ArrowRight size={18}/></button></>}
          {wallet.step==='playing'&&<div className="wager-hint"><span>{busy?'CREW IN MOTION':'YOUR NEXT MOVE'}</span><strong>{busy?'Give your crew a moment…':HINTS[Math.floor(history.length/2)]}</strong><p>{note||'A classic seven-ply checkmate opening.'}</p></div>}
          {wallet.step==='won'&&<button className="wager-primary" onClick={()=>setAuthorization('claim')}><Trophy size={18}/> CLAIM {ETH(pot)} ETH <ArrowRight size={18}/></button>}
          {wallet.step==='claimed'&&<><div className="wager-confirmed"><CheckCheck size={18}/> {ETH(pot)} ETH added to wallet</div><button className="wager-primary purple" onClick={()=>setAuthorization('convert')}><Gem size={18}/> CONVERT POT TO RBLX <ArrowRight size={18}/></button><p className="wager-footnote">Optional. Live conversion requires regional and wallet eligibility, a current quote, and a separate wallet transaction.</p></>}
          {wallet.step==='converted'&&<><div className="rblx-receipt"><span className="rblx-symbol">◇</span><div><small>RECEIVED IN WALKTHROUGH</small><strong>{wallet.rblx.toFixed(3)} RBLX</strong><span>Roblox · Robinhood Stock Token</span></div></div><button className="wager-primary" onClick={reset}>PLAY AGAIN <ArrowRight size={18}/></button></>}
        </div>
        <p className="wager-asset-note">RBLX is a tokenized debt security tracking Roblox, not Robux or Roblox shares. <a href="https://docs.robinhood.com/chain/stock-tokens/" target="_blank" rel="noreferrer">About Stock Tokens ↗</a></p>
      </aside>
      <div className="wager-arena">
        <div className="wager-match-heading"><span className="wager-crew-chip">◆ YOUR BLOCK CREW</span><div><small>SKY ISLANDS · CLASSIC CHESS</small><h2>YOU <span>vs</span> BLOX BARON</h2></div><span className="wager-crew-chip purple">◇ BARON’S CREW</span></div>
        <div className="wager-chess" data-fen={fen}><ChessScene board={board} selectedSquare={selected} legalMoves={legal} highlightedSquares={feedback?[feedback.from,feedback.to]:[]} onSquareClick={selectSquare} moveFeedback={feedback} cpuMode cpuThinking={busy&&!finished}/></div>
        {finished&&<div className="wager-victory"><Trophy size={24}/><div><strong>CHECKMATE. NICE BUILD.</strong><span>+{ETH(wallet.stake)} ETH profit before fees</span></div><CheckCheck size={21}/></div>}
        <div className="wager-moves"><div><span className="wager-status-dot"/>{finished?'YOU WIN':wallet.step==='playing'?(busy?'CREW IN MOTION':'YOUR MOVE'):'CREWS READY'}</div><span>{history.length?history.map((san,i)=>`${i%2===0?Math.floor(i/2)+1+'. ':''}${san}`).join('  '):'32 pieces. Two crews. One crown.'}</span></div>
      </div>
    </section>
    {authorization&&<div className="wager-modal-shade"><section className="wager-authorization" role="dialog" aria-modal="true" aria-labelledby="authorization-title"><button className="authorization-close" aria-label="Close authorization" disabled={busy} onClick={()=>setAuthorization(null)}><X size={20}/></button><div className="authorization-icon">{authorization==='convert'?<Gem size={30}/>:<Wallet size={30}/>}</div><p className="wager-kicker">CHESSBLOX WALLET · SIMULATION</p><h2 id="authorization-title">{authorization==='fund'?'Authorize your stake':authorization==='claim'?'Claim your winnings':'ETH → RBLX'}</h2><p>{authorization==='fund'?'Your stake joins an equal rival contribution.':authorization==='claim'?'The full match pot returns to your wallet.':'Convert the claimed pot with a separate wallet authorization.'}</p><div className="authorization-amount">{authorization==='fund'?ETH(wallet.stake):ETH(pot)} <small>ETH</small></div>{authorization==='convert'&&<div className="conversion-quote"><ArrowRight size={20}/><strong>{(pot*50).toFixed(3)} RBLX</strong><span>Illustrative rate: 1 ETH = 50 RBLX<br/>Fees excluded; live quotes vary.</span></div>}<div className="authorization-detail"><span>Destination</span><strong>{authorization==='fund'?'Match escrow':authorization==='claim'?'Your wallet':'Your RBLX balance'}</strong></div><button className="wager-primary" disabled={busy} onClick={authorize}>{busy?'PROCESSING…':authorization==='convert'?'AUTHORIZE CONVERSION':authorization==='claim'?'AUTHORIZE CLAIM':'AUTHORIZE STAKE'} {!busy&&<ArrowRight size={18}/>}</button></section></div>}
  </main>;
}
