import { createPublicClient, getAddress, http, isAddress } from 'viem';

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'BLOCKED'} ${name}`);
  if (!ok) failures++;
}
const env = process.env;
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PVP_REFEREE_SERVICE_TOKEN', 'ROBINHOOD_ESCROW_DEPLOY_BLOCK']) {
  check(`${key} configured`, Boolean(env[key]?.trim()) && !/your-project|your-public/.test(env[key]));
}
check('frontend and backend use the same database', Boolean(env.SUPABASE_URL) && env.SUPABASE_URL === env.VITE_SUPABASE_URL);
check('real wagers enabled deliberately', env.VITE_WAGER_NEW_WAGERS_ENABLED === 'true' && env.VITE_WAGER_REAL_ESCROW_ENABLED === 'true');
check('Robinhood payment mode selected', env.VITE_WAGER_PAYMENT_MODE === 'robinhood_eth_escrow');
check('development wallet disabled', env.VITE_ENABLE_DEV_WALLET !== 'true');
const escrow = env.ROBINHOOD_ESCROW_ADDRESS || '';
check('escrow address configured', isAddress(escrow));
check('frontend and backend escrow match', isAddress(escrow) && escrow.toLowerCase() === env.VITE_ROBINHOOD_ESCROW_ADDRESS?.toLowerCase());
check('result authority configured', isAddress(env.ROBINHOOD_RESULT_AUTHORITY || ''));
if (isAddress(escrow)) {
  try {
    const client = createPublicClient({ transport: http(env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com') });
    check('RPC is Robinhood mainnet', await client.getChainId() === 4663);
    const code = await client.getCode({ address: getAddress(escrow) });
    check('escrow has deployed bytecode', Boolean(code && code !== '0x'));
    const authority = await client.readContract({ address: getAddress(escrow), abi: [{ type: 'function', name: 'resultAuthority', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }], functionName: 'resultAuthority' });
    check('deployed result authority matches configuration', authority.toLowerCase() === env.ROBINHOOD_RESULT_AUTHORITY?.toLowerCase());
  } catch { check('on-chain configuration reachable and readable', false); }
}
console.log('This configuration check does not replace a funded end-to-end payout/refund test or security review.');
process.exitCode = failures ? 1 : 0;
