import { describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeFunctionData, keccak256, stringToHex } from 'viem';
const refereeModule = '../../supabase/functions/pvp-referee/robinhoodChain.ts';

// @vitest-environment node
describe('referee escrow compatibility', () => {
  it('decodes the claim transaction used to unlock prize conversion', async () => {
    const { robinhoodEscrowAbi } = await import(refereeModule);
    const contestId = keccak256(stringToHex('prize-claim'));
    const data = encodeFunctionData({ abi: robinhoodEscrowAbi, functionName: 'claimEth', args: [contestId] });
    expect(decodeFunctionData({ abi: robinhoodEscrowAbi, data })).toEqual({ functionName: 'claimEth', args: [contestId] });
  });
});
