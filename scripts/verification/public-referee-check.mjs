import { readFile, writeFile } from 'node:fs/promises';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
const env = Object.fromEntries((await readFile('.env.local','utf8')).split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
const endpoint = `${env.VITE_SUPABASE_URL}/functions/v1/pvp-referee`;
async function call(session, body) {
 const r = await fetch(endpoint,{method:'POST',headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json','User-Agent':'ChessBloxLaunchQA/1.0'},body:JSON.stringify({...session,...body})});
 const data=await r.json(); return {status:r.status,data};
}
function ok(r,label){if(r.status!==200)throw new Error(`${label}: ${r.status} ${r.data.error}`);return r.data;}
const s1=ok(await call(null,{action:'init_session'}),'init1');
const s2=ok(await call(null,{action:'init_session'}),'init2');
const session = s => ({sessionId:s.sessionId,sessionProof:s.sessionProof});
const a=session(s1),b=session(s2);
const hosted=ok(await call(a,{action:'create_lobby',matchType:'free',access:'invite',lobbyName:'PRIVATE LAUNCH QA',hostName:'QA',timeControl:'10+0'}),'private lobby');
const joined=ok(await call(b,{action:'join_game',gameId:hosted.gameId}),'join own test');
// Only this private, zero-stake test match is targeted.
await writeFile('.local/public-referee-test-session.json',JSON.stringify({a,b,hosted,joined}),{mode:0o600});
const phase = Date.now() % 60000;
if (phase > 15000) await new Promise(resolve=>setTimeout(resolve,61000-phase));
const rejected = await Promise.all(Array.from({length:21},()=>call(b,{action:'move',gameId:hosted.gameId,playerToken:'invalid-test-token',from:'e7',to:'e5',expectedPly:0,requestId:crypto.randomUUID()})));
if(rejected.filter(r=>r.status===403).length!==20 || rejected.filter(r=>r.status===429).length!==1) {
 await call(b,{action:'resign',gameId:hosted.gameId,playerToken:joined.playerToken});
 throw new Error(`Unexpected rejection counts: ${JSON.stringify(rejected.map(r=>r.status))}`);
}
const moved=ok(await call(a,{action:'move',gameId:hosted.gameId,playerToken:hosted.playerToken,from:'e2',to:'e4',expectedPly:0,requestId:crypto.randomUUID()}),'victim legal move');
if(moved.game?.moves?.[0]!=='e4')throw new Error('Victim move not saved');
ok(await call(b,{action:'resign',gameId:hosted.gameId,playerToken:joined.playerToken}),'finish private test');
// Ephemeral, unfunded key only signs authentication proofs. No transaction is sent.
const account=privateKeyToAccount(generatePrivateKey());
async function proof(action,gameId){
 const {walletProof}=ok(await call(a,{action:'create_wallet_proof_challenge',proofAction:action,walletAddress:account.address,gameId}),'challenge');
 const signature=await account.signMessage({message:walletProof.message});
 return {walletAddress:account.address,walletProofNonce:walletProof.nonce,walletProofExpiresAt:walletProof.expiresAt,walletSignature:Buffer.from(signature.slice(2),'hex').toString('base64')};
}
const p=await proof('list_robinhood_games');
const listed=ok(await call(a,{action:'list_robinhood_games',...p}),'recovery list');
if(listed.games.length!==0)throw new Error('Unfunded test wallet unexpectedly has games');
const replay=await call(a,{action:'list_robinhood_games',...p});
if(replay.status!==403)throw new Error('Nonce replay was not rejected');
const forbidden=await call(a,{action:'recover_robinhood_seat',gameId:hosted.gameId,...await proof('recover_robinhood_seat',hosted.gameId)});
if(forbidden.status!==403)throw new Error('Foreign seat recovery was not rejected');
const result={checkedAt:new Date().toISOString(),gameId:hosted.gameId,stake:'0',rateIsolation:true,legalMoveAccepted:true,privateGameFinished:true,walletProofList:true,nonceReplayRejected:true,foreignSeatRejected:true,financialTransactionsSent:0};
await writeFile('.local/public-referee-verification.json',JSON.stringify(result,null,2),{mode:0o600});
console.log(JSON.stringify(result,null,2));
