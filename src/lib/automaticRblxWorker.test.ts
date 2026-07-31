// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { payAutomaticRblx } from '../../scripts/automatic-rblx-payout-core.mjs';
const addr = (n: string) => `0x${n.repeat(40)}`;
const tx = `0x${'a'.repeat(64)}`, result = `0x${'b'.repeat(64)}`;
const row = { id:'game', payout_mode:'automatic_rblx', winner:'b', white_wallet_address:addr('1'), black_wallet_address:addr('2'), robinhood_escrow_address:addr('3'), escrow_contest_id:'contest', wager_stake_raw:'10', referee_result_hash:result, white_minimum_rblx:'100', black_minimum_rblx:'120' };
function fixture() {
  const calls: string[] = [];
  let payout = { asset:0, amount:0n, paidBlock:0n, settledAt:1000n, whiteMinimum:100n, blackMinimum:120n };
  const quote = { walletAddress:addr('2'), transaction:{to:addr('4'),chainId:4663,value:'20',data:'0x12345678'},quotedRblxOut:'150',minimumRblxOut:'140',expiresAt:new Date(Date.now()+120_000).toISOString() };
  const deps = {
    publicClient:{
      readContract:vi.fn(async ({functionName}: {functionName: string}) => functionName==='getPayout' ? payout : {state:payout.asset?6:3, creator:addr('1'),joiner:addr('2'),winner:addr('2'),stake:10n,resultHash:result}),
      getBlock:vi.fn().mockResolvedValue({timestamp:1100n}),
      simulateContract:vi.fn(async()=> {calls.push('simulate');}),
      waitForTransactionReceipt:vi.fn().mockResolvedValue({status:'success'}),
      getLogs:vi.fn(async()=>[{args:{asset:payout.asset,amount:payout.amount},transactionHash:tx}]),
    },
    wallet:{writeContract:vi.fn(async ({functionName}: {functionName:string})=> {calls.push('send'); payout={...payout,asset:functionName==='payRblx'?1:2,amount:functionName==='payRblx'?150n:20n,paidBlock:50n}; return tx;})},
    account:{},chain:{},escrow:addr('3'),escrowAbi:[],router:addr('4'),
    quotePrize:vi.fn().mockResolvedValue(quote),
    saveCheckpoint:vi.fn(async()=>{calls.push('checkpoint');}),
    recordPaid:vi.fn(async()=>{calls.push('paid');}),
  };
  return {deps,calls,quote,setPaid:()=>{payout={...payout,asset:1,amount:150n,paidBlock:50n};}};
}
describe('automatic payout worker',()=>{
  it('simulates, broadcasts, checkpoints and records the verified winner receipt',async()=>{
    const {deps,calls}=fixture(); await payAutomaticRblx(row,deps);
    expect(calls).toEqual(['simulate','send','checkpoint','paid']);
    expect(deps.recordPaid).toHaveBeenCalledWith({hash:tx,asset:'paid_rblx',amount:'150'});
    expect(deps.wallet.writeContract.mock.calls[0][0]).toMatchObject({functionName:'payRblx'});
  });
  it('recovers a payout mined before a worker crash without paying twice',async()=>{
    const {deps,setPaid}=fixture();setPaid(); await payAutomaticRblx(row,deps);
    expect(deps.wallet.writeContract).not.toHaveBeenCalled();expect(deps.quotePrize).not.toHaveBeenCalled();expect(deps.recordPaid).toHaveBeenCalledOnce();
  });
  it('pays full ETH after the window even if Uniswap is unavailable',async()=>{
    const {deps}=fixture();deps.publicClient.getBlock.mockResolvedValue({timestamp:1900n});deps.quotePrize.mockRejectedValue(new Error('offline'));
    await payAutomaticRblx(row,deps);expect(deps.quotePrize).not.toHaveBeenCalled();expect(deps.recordPaid).toHaveBeenCalledWith({hash:tx,asset:'paid_eth',amount:'20'});
  });
  it.each(['wrong winner','wrong router','overspend','low output','expired'])('blocks %s before any transaction',async reason=>{
    const {deps,quote}=fixture();
    if(reason==='wrong winner')quote.walletAddress=addr('1');if(reason==='wrong router')quote.transaction.to=addr('5');if(reason==='overspend')quote.transaction.value='21';if(reason==='low output')quote.quotedRblxOut='119';if(reason==='expired')quote.expiresAt='2020-01-01';
    await expect(payAutomaticRblx(row,deps)).rejects.toThrow();expect(deps.wallet.writeContract).not.toHaveBeenCalled();
  });
  it('keeps a timed-out checkpoint pending and does not broadcast another transaction',async()=>{
    const {deps}=fixture();deps.publicClient.waitForTransactionReceipt.mockRejectedValue(new Error('timeout'));
    await expect(payAutomaticRblx({...row,auto_payout_submitted_signature:tx},deps)).rejects.toThrow('timeout');
    expect(deps.saveCheckpoint).not.toHaveBeenCalled();expect(deps.wallet.writeContract).not.toHaveBeenCalled();
  });
  it('clears only a conclusively reverted checkpoint for retry',async()=>{
    const {deps}=fixture();deps.publicClient.waitForTransactionReceipt.mockResolvedValue({status:'reverted'});
    await expect(payAutomaticRblx({...row,auto_payout_submitted_signature:tx},deps)).rejects.toThrow('reverted');expect(deps.saveCheckpoint).toHaveBeenCalledWith(null);expect(deps.recordPaid).not.toHaveBeenCalled();
  });
});
