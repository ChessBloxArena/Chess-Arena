// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalEvm } from '../test/localEvm';
import solc from 'solc';
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, custom, defineChain, encodeFunctionData, keccak256, stringToHex, type Abi, type Address, type Hex } from 'viem';
import { automaticRblxAbi } from '../../supabase/functions/_shared/automaticRblx.mjs';

const sources = Object.fromEntries(['RobinhoodChessEscrowV2.sol', 'test/AutomaticPayoutMocks.sol'].map(name => [name, { content: readFileSync(`contracts/${name}`, 'utf8') }]));
const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { evmVersion: 'paris', optimizer: { enabled: true, runs: 500 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
if (compiled.errors?.some((e: {severity: string}) => e.severity === 'error')) throw new Error(JSON.stringify(compiled.errors));
const artifacts: Record<string, {abi: Abi; bytecode: Hex}> = {};
for (const file of Object.values(compiled.contracts) as Array<Record<string, {abi: Abi; evm: {bytecode: {object: string}}}>>) for (const [name, contract] of Object.entries(file)) artifacts[name] = { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
const { provider, accounts, close } = await createLocalEvm();

describe('Automatic RBLX escrow money invariants', () => {
  const chain = defineChain({ id: 1337, name: 'Local payout test', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1'] } } });
  const client = createPublicClient({ chain, transport: custom(provider as never), pollingInterval: 10, cacheTime: 0 });
  const wallet = createWalletClient({ chain, transport: custom(provider as never) });
  let escrow: Address, router: Address, token: Address;
  const deploy = async (name: string, args: readonly unknown[] = []) => {
    const hash = await wallet.deployContract({ ...artifacts[name], account: accounts[0], args });
    return (await client.waitForTransactionReceipt({ hash })).contractAddress!;
  };
  const read = (name: string, args: readonly unknown[]) => client.readContract({ address: escrow, abi: artifacts.RobinhoodChessEscrowV2.abi, functionName: name, args }) as Promise<Record<string, unknown>>;
  const tokenBalance = (address: Address) => client.readContract({ address: token, abi: artifacts.MockRblx.abi, functionName: 'balanceOf', args: [address] }) as Promise<bigint>;
  const send = async (who: number, name: string, args: readonly unknown[], value?: bigint) => {
    const hash = await wallet.writeContract({ account: accounts[who], address: escrow, abi: artifacts.RobinhoodChessEscrowV2.abi, functionName: name, args, value });
    return client.waitForTransactionReceipt({ hash });
  };
  const stamp = async () => (await client.getBlock()).timestamp;
  const id = (label: string) => keccak256(stringToHex(label));
  const result = id('authoritative-result');
  const stake = 10n ** 15n;
  const funded = async (label: string, winner = 1) => {
    const contest = id(label);
    await send(0, 'createRblxContest', [contest, await stamp() + 3600n, 100n], stake);
    await send(1, 'joinRblxContest', [contest, 120n], stake);
    await send(2, 'settleContest', [contest, accounts[winner].address, result]);
    return contest;
  };
  const route = (to: Address, amount: bigint) => encodeFunctionData({ abi: artifacts.MockSwapRouter.abi, functionName: 'swap', args: [to, amount] });
  beforeAll(async () => { token = await deploy('MockRblx'); router = await deploy('MockSwapRouter', [token]); escrow = await deploy('RobinhoodChessEscrowV2', [accounts[2].address, router, token]); }, 30_000);
  afterAll(close);
  it('has no legacy entry bypass, zero minimum, or unequal deposit path', async () => {
    expect(artifacts.RobinhoodChessEscrowV2.abi.some(e => e.type === 'function' && e.name === 'createContest')).toBe(false);
    await expect(send(0, 'createRblxContest', [id('zero'), await stamp() + 3600n, 0n], stake)).rejects.toThrow();
    const contest = id('mismatch');
    await send(0, 'createRblxContest', [contest, await stamp() + 3600n, 100n], stake);
    await expect(send(1, 'joinRblxContest', [contest, 0n], stake)).rejects.toThrow();
    await expect(send(1, 'joinRblxContest', [contest, 100n], stake + 1n)).rejects.toThrow();
    await send(0, 'cancelUnmatched', [contest]);
  }, 30_000);
  it('delivers RBLX directly to the winner without changing their ETH balance or spending another pot', async () => {
    const first = await funded('automatic-win');
    const second = await funded('other-pot');
    const beforeEth = await client.getBalance({address: accounts[1].address});
    const beforeToken = await tokenBalance(accounts[1].address);
    const beforeEscrow = await client.getBalance({address: escrow});
    await send(2, 'payRblx', [first, route(accounts[1].address, 150n), 130n, await stamp() + 60n]);
    expect(await tokenBalance(accounts[1].address) - beforeToken).toBe(150n);
    expect(await client.getBalance({address: accounts[1].address})).toBe(beforeEth);
    expect(beforeEscrow - await client.getBalance({address: escrow})).toBe(stake * 2n);
    expect((await read('getContest', [second])).state).toBe(3);
    const payout = await read('getPayout', [first]);
    expect(payout.asset).toBe(1); expect(payout.amount).toBe(150n); expect(payout.paidBlock).toBeGreaterThan(0n);
    await expect(send(2, 'payRblx', [first, route(accounts[1].address, 150n), 120n, await stamp() + 60n])).rejects.toThrow();
    await expect(send(1, 'claimEth', [first])).rejects.toThrow();
  }, 30_000);
  it('rejects outsider payout, wrong recipient, below-minimum output and reentrancy atomically', async () => {
    const contest = await funded('guards');
    const before = await client.getBalance({address: escrow});
    await expect(send(3, 'payRblx', [contest, route(accounts[1].address, 150n), 120n, await stamp() + 60n])).rejects.toThrow();
    await expect(send(2, 'payRblx', [contest, route(accounts[3].address, 150n), 120n, await stamp() + 60n])).rejects.toThrow();
    await expect(send(2, 'payRblx', [contest, route(accounts[1].address, 119n), 120n, await stamp() + 60n])).rejects.toThrow();
    await expect(send(2, 'payRblx', [contest, route(accounts[1].address, 150n), 119n, await stamp() + 60n])).rejects.toThrow();
    const reentry = encodeFunctionData({abi: artifacts.MockSwapRouter.abi, functionName:'reenter', args:[encodeFunctionData({abi: automaticRblxAbi, functionName:'payEthFallback', args:[contest]})]});
    await expect(send(2, 'payRblx', [contest, reentry, 120n, await stamp() + 60n])).rejects.toThrow();
    expect(await client.getBalance({address: escrow})).toBe(before);
    expect((await read('getContest', [contest])).state).toBe(3);
    expect((await read('getPayout', [contest])).asset).toBe(0);
  }, 30_000);
  it('keeps a failed swap claimable and allows a sponsored full ETH fallback after the window', async () => {
    const contest = await funded('fallback');
    const fail = encodeFunctionData({abi: artifacts.MockSwapRouter.abi, functionName:'fail'});
    await expect(send(2, 'payRblx', [contest, fail, 120n, await stamp() + 60n])).rejects.toThrow();
    await expect(send(3, 'payEthFallback', [contest])).rejects.toThrow();
    await expect(send(1, 'claimEth', [contest])).rejects.toThrow();
    expect(await read('claimableAmount', [contest, accounts[1].address])).toBe(0n);
    await provider.request({method:'evm_increaseTime',params:[901]}); await provider.request({method:'evm_mine',params:[]});
    await expect(send(2, 'payRblx', [contest, route(accounts[1].address, 150n), 120n, await stamp() + 60n])).rejects.toThrow();
    const before = await client.getBalance({address:accounts[1].address});
    await send(3, 'payEthFallback', [contest]);
    expect(await client.getBalance({address:accounts[1].address}) - before).toBe(stake*2n);
    expect((await read('getPayout',[contest])).asset).toBe(2);
    await expect(send(1, 'claimEth', [contest])).rejects.toThrow();
  }, 30_000);
  it('allows the winner to recover ETH without the worker and preserves draw refunds', async () => {
    const contest = await funded('self-recovery');
    await provider.request({method:'evm_increaseTime',params:[901]}); await provider.request({method:'evm_mine',params:[]});
    await send(1,'claimEth',[contest]);
    const draw = id('draw');
    await send(0,'createRblxContest',[draw,await stamp()+3600n,100n],stake);
    await send(1,'joinRblxContest',[draw,100n],stake);
    await send(2,'settleContest',[draw,'0x0000000000000000000000000000000000000000',result]);
    await expect(send(3,'claimEth',[draw])).rejects.toThrow();
    for (const who of [0,1]) { await send(who,'claimEth',[draw]); await expect(send(who,'claimEth',[draw])).rejects.toThrow(); }
    expect((await read('getContest',[draw])).state).toBe(6);
  }, 30_000);
});
