import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { enterRobinhoodWagerQueue, getRobinhoodRblxQuote, swapRobinhoodPrizeForRblx } from './robinhoodWagerClient';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), confirm: vi.fn(), proof: vi.fn(), save: vi.fn(), referee: vi.fn() }));
vi.mock('./robinhoodPendingWager', () => ({ readPendingRobinhoodWager: () => null, savePendingRobinhoodWager: mocks.save }));
vi.mock('@/lib/wagerRefereeClient', () => ({
  prepareWagerQueue: mocks.prepare, confirmWagerDeposit: mocks.confirm,
  signWalletProof: mocks.proof, invokeWagerReferee: mocks.referee, prepareWagerLobby: vi.fn(), prepareWagerLobbyJoin: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_ROBINHOOD_ESCROW_ADDRESS', '0xfbba217fb9a493f12f0170a7f6b258ef1f7d2724');
  mocks.proof.mockResolvedValue({ walletSignature: 'proof' });
  mocks.confirm.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllEnvs());

describe('website ETH deposit handoff', () => {
  const prepared = { gameId: 'game-a', color: 'w', playerToken: 'player-token', depositRole: 'white', contestId: 'contest-a', stakeLamports: '25000000000000000', assetMint: '0x0000000000000000000000000000000000000000' };
  const args = () => ({ address: '0x1111111111111111111111111111111111111111' as const, sessionId: 'session-a', stakeWei: 25_000_000_000_000_000n, signMessage: vi.fn(), writeContract: vi.fn().mockResolvedValue(`0x${'a'.repeat(64)}`), onPrepared: vi.fn() });

  it('passes the reviewed stake to escrow and confirms its receipt with the referee', async () => {
    mocks.prepare.mockResolvedValue(prepared);
    const wallet = args();
    const result = await enterRobinhoodWagerQueue(wallet);
    expect(wallet.writeContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'createContest', value: wallet.stakeWei }));
    expect(wallet.onPrepared).toHaveBeenCalledWith(prepared);
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ gameId: 'game-a', stakeLamports: wallet.stakeWei, transactionSignature: result.signature }));
    expect(result.gameId).toBe('game-a');
  });

  it('never requests a payment when the prepared stake differs from the reviewed invite', async () => {
    mocks.prepare.mockResolvedValue({ ...prepared, stakeLamports: '30000000000000000' });
    const wallet = args();
    await expect(enterRobinhoodWagerQueue(wallet)).rejects.toThrow('stake differs');
    expect(wallet.writeContract).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});

describe('reviewed RBLX swap handoff', () => {
  const claim = `0x${'1'.repeat(64)}` as const;
  const quote = { gameId:'game-a', claimTransactionHash:claim, walletAddress:'0x1111111111111111111111111111111111111111' as const,
    transaction:{to:'0x8876789976decbfcbbbe364623c63652db8c0904' as const, data:'0x12345678' as const,value:'20',chainId:4663},
    minimumRblxOut:'9',quotedRblxOut:'10',slippageBps:100,expiresAt:'2030-01-01T00:00:00Z'};
  const args = () => ({ gameId:'game-a',playerToken:'player-token',claimTransactionHash:claim,expectedPrizeWei:20n,quote,
    wallet:{address:quote.walletAddress,signMessage:vi.fn(),writeContract:vi.fn(),sendTransaction:vi.fn().mockResolvedValue(`0x${'b'.repeat(64)}`)}});
  it('fetches a quote without requesting any transaction', async () => {
    mocks.referee.mockResolvedValue(quote);
    const input=args();
    expect(await getRobinhoodRblxQuote(input)).toEqual(quote);
    expect(input.wallet.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.referee).toHaveBeenCalledWith(expect.objectContaining({uniswapTermsAccepted:true,claimTransactionHash:claim}));
  });
  it('sends exactly the reviewed transaction without silently fetching a new quote', async () => {
    const input=args();
    await swapRobinhoodPrizeForRblx(input);
    expect(input.wallet.sendTransaction).toHaveBeenCalledWith({to:quote.transaction.to,data:quote.transaction.data,value:20n,operationId:'rblx:game-a'});
    expect(mocks.referee).not.toHaveBeenCalled();
  });
  it.each(['expired','wallet changed','different prize','overspend'])('rejects %s before opening the wallet', async reason => {
    const input=args();
    if(reason==='expired') input.quote={...quote,expiresAt:'2020-01-01T00:00:00Z'};
    if(reason==='wallet changed') input.quote={...quote,walletAddress:'0x2222222222222222222222222222222222222222' as typeof quote.walletAddress};
    if(reason==='different prize') input.quote={...quote,gameId:'game-b'};
    if(reason==='overspend') input.quote={...quote,transaction:{...quote.transaction,value:'21'}};
    await expect(swapRobinhoodPrizeForRblx(input)).rejects.toThrow();
    expect(input.wallet.sendTransaction).not.toHaveBeenCalled();
  });
});


describe('automatic prize deposit authorization', () => {
  const escrow = '0x3333333333333333333333333333333333333333';
  const quote = { version: 1 as const, chainId: 4663 as const, escrowAddress: escrow, walletAddress: '0x1111111111111111111111111111111111111111', stakeWei: '25000000000000000', minimumRblxOut: '2900000000000000000', quotedRblxOut: '3000000000000000000', expiresAt: '2030-01-01T00:00:00Z', fallbackSeconds: 900 as const, token: 'signed', payoutMode: 'automatic_rblx' as const };
  const prepared = { gameId: 'auto-game', color: 'w', playerToken: 'token', depositRole: 'white', contestId: 'auto-contest', stakeLamports: quote.stakeWei, assetMint: '0x0000000000000000000000000000000000000000', escrowAddress: escrow, payoutMode: 'automatic_rblx', minimumRblxOut: quote.minimumRblxOut };
  const args = () => ({ address: quote.walletAddress as `0x${string}`, sessionId: 'session', stakeWei: BigInt(quote.stakeWei), signMessage: vi.fn(), writeContract: vi.fn().mockResolvedValue(`0x${'a'.repeat(64)}`), reviewPayout: vi.fn().mockResolvedValue({token:quote.token, accepted:true, quote}) });
  beforeEach(() => { vi.stubEnv('VITE_AUTOMATIC_RBLX_PAYOUT_ENABLED','true'); vi.stubEnv('VITE_ROBINHOOD_AUTO_ESCROW_ADDRESS',escrow); mocks.prepare.mockResolvedValue(prepared); });
  it('records the reviewed minimum directly in the new escrow deposit', async () => {
    const input=args(); await enterRobinhoodWagerQueue(input);
    expect(input.reviewPayout).toHaveBeenCalledOnce();
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({payoutAuthorization:{token:'signed',accepted:true}}));
    expect(input.writeContract).toHaveBeenCalledWith(expect.objectContaining({address:escrow,functionName:'createRblxContest',value:input.stakeWei,args:[expect.any(String),expect.any(BigInt),BigInt(quote.minimumRblxOut)]}));
  });
  it.each(['minimum','escrow','mode'])('rejects a changed %s before depositing', async changed => {
    const wrong = {...prepared}; if(changed==='minimum')wrong.minimumRblxOut='1';if(changed==='escrow')wrong.escrowAddress='0xfbba217fb9a493f12f0170a7f6b258ef1f7d2724';if(changed==='mode')wrong.payoutMode='eth_claim';
    mocks.prepare.mockResolvedValue(wrong);const input=args();await expect(enterRobinhoodWagerQueue(input)).rejects.toThrow();expect(input.writeContract).not.toHaveBeenCalled();
  });
  it('does not even prepare a deposit after the user cancels', async () => {const input=args();input.reviewPayout.mockRejectedValue(new Error('cancelled'));await expect(enterRobinhoodWagerQueue(input)).rejects.toThrow('cancelled');expect(mocks.prepare).not.toHaveBeenCalled();expect(input.writeContract).not.toHaveBeenCalled();});
});
