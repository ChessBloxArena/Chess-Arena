// Read-only verification after the user signs the prepared deployment.
import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, encodeDeployData, getAddress, http, parseAbi } from 'viem';

const hash = process.argv[2];
if (!/^0x[0-9a-fA-F]{64}$/.test(hash || '')) throw new Error('Usage: node scripts/verify-robinhood-auto-deployment.mjs <deployment transaction hash>');
const artifact = JSON.parse(await readFile('artifacts/RobinhoodChessEscrowV2.json', 'utf8'));
const details = JSON.parse(await readFile('artifacts/auto-escrow-deployment/details.json', 'utf8'));
const client = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com') });
if (await client.getChainId() !== 4663) throw new Error('Wrong network');
const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Successful contract creation receipt required');
const transaction = await client.getTransaction({ hash });
const expected = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [details.resultAuthority, details.router, details.rblxToken] });
if (transaction.to !== null || transaction.value !== 0n || transaction.input.toLowerCase() !== expected.toLowerCase()) throw new Error('Deployment transaction differs from the reviewed contract');
const address = getAddress(receipt.contractAddress);
const abi = parseAbi(['function resultAuthority() view returns (address)', 'function swapRouter() view returns (address)', 'function rblxToken() view returns (address)', 'function FALLBACK_DELAY() view returns (uint256)']);
const [authority, router, token, delay, code, simulated] = await Promise.all([
  client.readContract({ address, abi, functionName: 'resultAuthority' }),
  client.readContract({ address, abi, functionName: 'swapRouter' }),
  client.readContract({ address, abi, functionName: 'rblxToken' }),
  client.readContract({ address, abi, functionName: 'FALLBACK_DELAY' }),
  client.getCode({ address }),
  client.call({ account: transaction.from, data: expected }),
]);
if (authority.toLowerCase() !== details.resultAuthority.toLowerCase() || router.toLowerCase() !== details.router.toLowerCase() || token.toLowerCase() !== details.rblxToken.toLowerCase() || delay !== 900n || code !== simulated.data) throw new Error('Deployed runtime or immutable configuration mismatch');
const report = { checkedAt: new Date().toISOString(), chainId: 4663, escrowAddress: address, deploymentTransaction: hash, deploymentBlock: receipt.blockNumber.toString(), authority, router, rblxToken: token, fallbackSeconds: Number(delay), exactCreationBytecode: true, exactRuntimeBytecode: true, verified: true, financialTransactionsSent: 0 };
await writeFile('artifacts/auto-escrow-deployment/verified.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
