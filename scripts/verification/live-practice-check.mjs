import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').trim().split('\n').map(line => { const i=line.indexOf('='); return [line.slice(0,i),line.slice(i+1)]; }));
async function call(body) {
 const response = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/pvp-referee`, {method:'POST', headers:{'content-type':'application/json',apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,'user-agent':'ChessBlox-live-verification'},body:JSON.stringify(body)});
 const result=await response.json();
 if(!response.ok) throw new Error(`${body.action}: ${response.status} ${result.error}`);
 return result;
}
const white=await call({action:'init_session',clientVersion:'verification'});
const black=await call({action:'init_session',clientVersion:'verification'});
const a=await call({...white,action:'join_queue',timeControl:'10+0'});
const b=await call({...black,action:'join_game',gameId:a.gameId});
if(a.color!=='w'||b.color!=='b') throw new Error('Unexpected seats');
let result;
for(const [ply,[from,to]] of [['f2','f3'],['e7','e5'],['g2','g4'],['d8','h4']].entries()) {
 const session=ply%2===0?white:black;
 result=await call({...session, action:'move',gameId:a.gameId,playerToken:ply%2===0?a.playerToken:b.playerToken,from,to,expectedPly:ply,requestId:randomUUID()});
}
const game=result.game;
if(game.status!=='finished'||game.winner!=='b') throw new Error('Checkmate not recorded');
const report={gameId:a.gameId,status:game.status,winner:game.winner,moves:game.moves,realCrypto:false,checkedAt:new Date().toISOString()};
writeFileSync('.local/live-practice-result.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
