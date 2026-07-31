// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { signRblxAuthorization, verifyRblxAuthorization, type RblxEntryAuthorization } from '../../supabase/functions/pvp-referee/rblxAuthorization';
import { resolveGameEscrow } from '../../supabase/functions/_shared/automaticRblx.mjs';
const payload: RblxEntryAuthorization = {version:1,chainId:4663,escrowAddress:`0x${'1'.repeat(40)}`,walletAddress:`0x${'2'.repeat(40)}`,stakeWei:'100',minimumRblxOut:'990',quotedRblxOut:'1000',expiresAt:'2030-01-01T00:00:00Z',fallbackSeconds:900};
const secret='a-local-test-only-secret-of-at-least-32-characters';
describe('entry authorization binding',()=>{
  it('authenticates the exact wallet, prize minimum, stake, chain and escrow',async()=>{const token=await signRblxAuthorization(payload,secret);expect(await verifyRblxAuthorization(token,secret,payload)).toEqual(payload);});
  it.each(['walletAddress','escrowAddress','stakeWei'])('rejects changed %s',async field=>{const token=await signRblxAuthorization(payload,secret);await expect(verifyRblxAuthorization(token,secret,{...payload,[field]:'changed'})).rejects.toThrow('invalid');});
  it('rejects tampering, another signing key and stale authorization',async()=>{const token=await signRblxAuthorization(payload,secret);await expect(verifyRblxAuthorization(`${token.slice(0,20)}x${token.slice(21)}`,secret,payload)).rejects.toThrow();await expect(verifyRblxAuthorization(token,secret+'other',payload)).rejects.toThrow();await expect(verifyRblxAuthorization(token,secret,payload,Date.parse(payload.expiresAt))).rejects.toThrow('expired');});
  it('keeps legacy matches on the old escrow when the new address is configured',()=>{expect(resolveGameEscrow(null,payload.escrowAddress,payload.walletAddress).toLowerCase()).toBe(payload.escrowAddress);expect(resolveGameEscrow(payload.walletAddress,payload.escrowAddress,payload.walletAddress).toLowerCase()).toBe(payload.walletAddress);expect(()=>resolveGameEscrow(`0x${'3'.repeat(40)}`,payload.escrowAddress,payload.walletAddress)).toThrow('unrecognized');});
});
