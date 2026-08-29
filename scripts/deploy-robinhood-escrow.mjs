import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

const RPC_URL = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const privateKey = process.env.ROBINHOOD_DEPLOYER_PRIVATE_KEY;
const resultAuthority = process.env.ROBINHOOD_RESULT_AUTHORITY;
if (!privateKey?.match(/^0x[0-9a-fA-F]{64}$/)) throw new Error("Set ROBINHOOD_DEPLOYER_PRIVATE_KEY");
if (!resultAuthority) throw new Error("Set ROBINHOOD_RESULT_AUTHORITY");

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const artifact = JSON.parse(await readFile(new URL("../artifacts/RobinhoodChessEscrow.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(privateKey);
const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
if (await publicClient.getChainId() !== chain.id) throw new Error("Unexpected deployment RPC chain");
if (await publicClient.getBalance({ address: account.address }) === 0n) throw new Error("Deployment signer needs ETH for gas");
const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [getAddress(resultAuthority)],
});
console.log(`Deployment transaction: https://robinhoodchain.blockscout.com/tx/${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Deployment failed or has no contract address");
await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
await writeFile(new URL("../.local/robinhood-deployment.json", import.meta.url), JSON.stringify({ chainId: chain.id, address: receipt.contractAddress, resultAuthority: getAddress(resultAuthority), deployBlock: receipt.blockNumber.toString(), transactionHash: hash }, null, 2));
console.log(`ROBINHOOD_ESCROW_DEPLOY_BLOCK=${receipt.blockNumber}`);
console.log(`ROBINHOOD_ESCROW_ADDRESS=${receipt.contractAddress}`);
console.log(`VITE_ROBINHOOD_ESCROW_ADDRESS=${receipt.contractAddress}`);
