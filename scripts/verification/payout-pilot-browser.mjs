import {createPublicClient,http,encodeFunctionData,keccak256,stringToHex,hexToBytes} from 'viem';
const config=await fetch('payout-pilot-config.json').then(r=>r.json());
const chain=createPublicClient({transport:http('https://rpc.mainnet.chain.robinhood.com',{timeout:15000})});
const stake=BigInt(config.stake), zero='0x0000000000000000000000000000000000000000';
const output=document.querySelector('#status'), buttons=[...document.querySelectorAll('button')];
let state=JSON.parse(localStorage.getItem(config.storageKey)||'{"players":[{},{}]}'),busy=false;
const save=()=>localStorage.setItem(config.storageKey,JSON.stringify(state));
const message=text=>{output.textContent=text+(state.gameId?'\n\nMatch: '+state.gameId:'')+(state.claimHash?'\nPayout: '+state.claimHash:'');};
async function api(i,body){
 const response=await fetch(config.url+'/functions/v1/pvp-referee',{method:'POST',headers:{'content-type':'application/json',apikey:config.key},body:JSON.stringify({...state.players[i].session,...body}),signal:AbortSignal.timeout(20000)});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Backend request failed');return data;
}
async function selected(i){
 if(!window.ethereum)throw Error('Open this page in Chrome with MetaMask.');
 const accounts=await ethereum.request({method:'eth_requestAccounts'});
 if(accounts[0]?.toLowerCase()!==config.wallets[i].toLowerCase())throw Error('Select Wallet '+(i+8)+' in MetaMask, then retry this step.');
 if(Number(await ethereum.request({method:'eth_chainId'}))!==4663)await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});
 if(Number(await ethereum.request({method:'eth_chainId'}))!==4663)throw Error('Select Robinhood Chain.');
 return accounts[0];
}
async function send(i,functionName,args,value=0n){
 const from=await selected(i);
 return ethereum.request({method:'eth_sendTransaction',params:[{from,to:config.escrow,chainId:'0x1237',value:'0x'+value.toString(16),data:encodeFunctionData({abi:config.abi,functionName,args})}]});
}
async function getGame(){return (await api(0,{action:'get_game',gameId:state.gameId,playerToken:state.players[0].prepared.playerToken})).game;}
const terms=i=>({walletAddress:config.wallets[i],assetMint:zero,tokenProgramId:'',paymentMode:'robinhood_eth_escrow',stakeRaw:config.stake,stakeLamports:config.stake,timeControl:'10+0'});
async function deposit(i){
 const p=state.players[i];await selected(i);
 if(i===1&&!state.players[0].confirmed)throw Error('Complete Wallet 8’s deposit first.');
 if(!p.session){p.session=await api(i,{action:'init_session',clientVersion:'private-payout-verification'});save();}
 if(!p.prepared){
  const action=i===0?'prepare_wager_queue':'prepare_black_deposit';
  const {walletProof}=await api(i,{action:'create_wallet_proof_challenge',proofAction:action,walletAddress:config.wallets[i],...(i===1?{gameId:state.gameId}:{})});
  message('Confirm the wallet ownership signature. It does not transfer ETH.');
  const signature=await ethereum.request({method:'personal_sign',params:[stringToHex(walletProof.message),await selected(i)]});
  const prepared=await api(i,{action,...terms(i),...(i===1?{gameId:state.gameId}:{}),walletProofNonce:walletProof.nonce,walletProofExpiresAt:walletProof.expiresAt,walletSignature:btoa(String.fromCharCode(...hexToBytes(signature)))});
  if(i===0){if(prepared.color!=='w'||prepared.depositRole!=='white'||prepared.stakeLamports!==config.stake)throw Error('Unexpected match preparation. No deposit sent.');state.gameId=prepared.gameId;state.contestId=prepared.contestId;}
  else if(prepared.color!=='b'||prepared.gameId!==state.gameId||prepared.game?.wager_stake_raw!==config.stake)throw Error('Unexpected opponent preparation. No deposit sent.');
  p.prepared=prepared;save();
 }
 const key=keccak256(stringToHex(state.contestId));
 if(!p.hash){message('Review the 0.000001 ETH deposit and fee in Wallet '+(i+8)+'.');p.hash=await send(i,i===0?'createContest':'joinContest',i===0?[key,BigInt(Math.floor(Date.now()/1000)+86400)]:[key],stake);save();}
 await verifySavedDeposit(i);
}
async function verifySavedDeposit(i){
 const p=state.players[i];if(!p.hash)throw Error('No saved deposit to verify.');
 message('Checking your existing deposit. No new payment will be sent.');
 const receipt=await chain.waitForTransactionReceipt({hash:p.hash,confirmations:2,timeout:120000});if(receipt.status!=='success')throw Error('Deposit reverted. Keep this page and ask Codex to inspect it.');
 await api(i,{action:i===0?'confirm_white_deposit':'confirm_black_deposit',...terms(i),gameId:state.gameId,playerToken:p.prepared.playerToken,transactionSignature:p.hash,escrowContestId:state.contestId});
 p.confirmed=true;save();message(i===0?'Wallet 8 deposit confirmed. Select Wallet 9, then use step 2.':'Both deposits confirmed. Use step 3 to run the four-move test.');
}
async function play(){
 if(!state.players.every(p=>p.confirmed))throw Error('Complete both deposits first.');
 let game=await getGame();const moves=[['f2','f3'],['e7','e5'],['g2','g4'],['d8','h4']],san=['f3','e5','g4','Qh4#'];
 if(!game.moves.every((move,i)=>move===san[i]))throw Error('Unexpected moves; stop and ask Codex to inspect.');
 for(let ply=game.moves.length;ply<4;ply++){
  const i=ply%2,[from,to]=moves[ply];
  const r=await api(i,{action:'move',gameId:state.gameId,playerToken:state.players[i].prepared.playerToken,from,to,expectedPly:ply,requestId:crypto.randomUUID()});game=r.game;
 }
 if(game.status!=='finished'||game.winner!=='b')throw Error('Expected checkmate was not recorded.');
 state.finished=true;save();message('Checkmate recorded. Wallet 9 won. Waiting for the deployed payout worker…');
}
async function refresh(){
 if(state.finished&&!state.paid){
  const contest=await chain.readContract({address:config.escrow,abi:config.abi,functionName:'getContest',args:[keccak256(stringToHex(state.contestId))]});
  if([3,6].includes(Number(contest.state))&&contest.winner.toLowerCase()===config.wallets[1].toLowerCase()&&contest.stake===stake){state.settled=true;if(Number(contest.state)===6)state.paid=true;save();}
 }
 buttons[0].disabled=busy||state.players[0].confirmed;
 buttons[1].disabled=busy||!state.players[0].confirmed||state.players[1].confirmed;
 buttons[2].disabled=busy||!state.players.every(p=>p.confirmed)||state.finished;
 buttons[3].disabled=busy||!state.settled||state.paid;
 if(state.paid)message('Payout confirmed. Wallet 9 received the 0.000002 ETH pot. Codex can now verify the match and transaction.');
 else if(state.settled)message('The deployed worker settled the match. Select Wallet 9 and use step 4 to claim 0.000002 ETH.');
}
async function claim(){
 await refresh();if(!state.settled||state.paid)return;
 if(!state.claimHash){state.claimHash=await send(1,'claimEth',[keccak256(stringToHex(state.contestId))]);save();}
 const receipt=await chain.waitForTransactionReceipt({hash:state.claimHash,confirmations:2,timeout:120000});if(receipt.status!=='success')throw Error('Payout claim reverted. Ask Codex to inspect.');await refresh();
}
const tasks=[()=>deposit(0),()=>deposit(1),play,claim];
buttons.forEach((button,i)=>button.onclick=async()=>{if(busy)return;busy=true;buttons.forEach(b=>b.disabled=true);try{await tasks[i]();}catch(e){message(e.message+'\nSaved transactions will be reused on retry; no second deposit is requested.');}finally{busy=false;await refresh();}});
message('Start with Wallet 8. Each wallet deposits 0.000001 ETH plus network fees.');
 busy=true;try{for(let i=0;i<2;i++){if(state.players[i].hash&&!state.players[i].confirmed)await verifySavedDeposit(i);}}catch(e){message(e.message+'\nYour existing deposit is saved. No new payment was sent.');}finally{busy=false;}
 await refresh();
setInterval(()=>{if(!busy&&state.finished&&!state.paid)refresh().catch(e=>message(e.message));},10000);
