// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalEvm } from "../test/localEvm";
import solc from "solc";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  keccak256,
  parseEther,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

const { provider, accounts: localAccounts, close } = await createLocalEvm();

interface Artifact { abi: Abi; bytecode: Hex }

function compileContracts(): Record<string, Artifact> {
  const input = {
    language: "Solidity",
    sources: {
      "RobinhoodChessEscrow.sol": { content: readFileSync("contracts/RobinhoodChessEscrow.sol", "utf8") },
    },
    settings: { optimizer: { enabled: true, runs: 500 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((entry: { severity: string }) => entry.severity === "error");
  if (errors.length) throw new Error(errors.map((entry: { formattedMessage: string }) => entry.formattedMessage).join("\n"));
  const artifacts: Record<string, Artifact> = {};
  for (const contracts of Object.values(output.contracts) as Array<Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>>) {
    for (const [name, contract] of Object.entries(contracts)) {
      artifacts[name] = { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
    }
  }
  return artifacts;
}

describe("RobinhoodChessEscrow", () => {
  const testChain = defineChain({ id: 1337, name: "Local escrow test", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1"] } } });
  const publicClient = createPublicClient({ chain: testChain, transport: custom(provider as never), pollingInterval: 10 });
  const wallet = createWalletClient({ account: localAccounts[0], chain: testChain, transport: custom(provider as never) });
  const artifacts = compileContracts();
  let accounts: readonly Address[];
  let escrow: Address;

  const deploy = async (artifact: Artifact, account: Address, args: readonly unknown[] = []) => {
    const localAccount = localAccounts.find((candidate) => candidate.address.toLowerCase() === account.toLowerCase());
    if (!localAccount) throw new Error("Missing local account");
    const hash = await wallet.deployContract({ account: localAccount, abi: artifact.abi, bytecode: artifact.bytecode, args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error("Deployment failed");
    return receipt.contractAddress;
  };

  const send = async (account: Address, functionName: string, args: readonly unknown[], value?: bigint) => {
    const localAccount = localAccounts.find((candidate) => candidate.address.toLowerCase() === account.toLowerCase());
    if (!localAccount) throw new Error("Missing local account");
    const hash = await wallet.writeContract({ account: localAccount, address: escrow, abi: artifacts.RobinhoodChessEscrow.abi, functionName, args, value });
    return publicClient.waitForTransactionReceipt({ hash });
  };

  beforeAll(async () => {
    accounts = localAccounts.map((account) => account.address);
    escrow = await deploy(artifacts.RobinhoodChessEscrow, accounts[0], [accounts[2]]);
  });
  afterAll(close);

  it("escrows equal native ETH stakes and lets only the winner claim the pot", async () => {
    const contest = keccak256(stringToHex("eth-prize"));
    const stake = parseEther("0.25");
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
    await send(accounts[0], "createContest", [contest, expiresAt], stake);
    await send(accounts[1], "joinContest", [contest], stake);
    await expect(send(accounts[0], "settleContest", [contest, accounts[0], keccak256(stringToHex("result"))])).rejects.toThrow();
    await send(accounts[2], "settleContest", [contest, accounts[0], keccak256(stringToHex("result"))]);
    await expect(send(accounts[1], "claimEth", [contest])).rejects.toThrow();
    await send(accounts[0], "claimEth", [contest]);
    const state = await publicClient.readContract({ address: escrow, abi: artifacts.RobinhoodChessEscrow.abi, functionName: "getContest", args: [contest] }) as { state: number };
    expect(state.state).toBe(6);
  }, 30_000);

  it("pays the winner in ETH before any separate wallet conversion", async () => {
    const contest = keccak256(stringToHex("separate-wallet-swap"));
    const stake = parseEther("0.1");
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
    await send(accounts[0], "createContest", [contest, expiresAt], stake);
    await send(accounts[1], "joinContest", [contest], stake);
    await send(accounts[2], "settleContest", [contest, accounts[1], keccak256(stringToHex("wallet-swap-result"))]);
    expect(await publicClient.getBalance({ address: escrow })).toBe(stake * 2n);
    const before = await publicClient.getBalance({ address: accounts[1], blockTag: "latest" });
    const claim = await send(accounts[1], "claimEth", [contest]);
    const after = await publicClient.getBalance({ address: accounts[1], blockTag: "latest" });
    expect(after - before + claim.gasUsed * claim.effectiveGasPrice).toBe(stake * 2n);
    expect(await publicClient.getBalance({ address: escrow })).toBe(0n);
    await expect(send(accounts[1], "claimEth", [contest])).rejects.toThrow();
    expect(artifacts.RobinhoodChessEscrow.abi.some((entry) => entry.type === "function" && entry.name === "claimRblx")).toBe(false);
  }, 30_000);

  it("refunds each draw participant exactly once and rejects outsiders", async () => {
    const contest = keccak256(stringToHex("draw-refunds"));
    const stake = parseEther("0.02");
    const latest = await publicClient.getBlock();
    await send(accounts[0], "createContest", [contest, latest.timestamp + 3600n], stake);
    await send(accounts[1], "joinContest", [contest], stake);
    await send(accounts[2], "settleContest", [contest, "0x0000000000000000000000000000000000000000", keccak256(stringToHex("draw"))]);
    await expect(send(accounts[3], "claimEth", [contest])).rejects.toThrow();
    for (const player of [accounts[0], accounts[1]]) {
      const before = await publicClient.getBalance({ address: player, blockTag: "latest" });
      const claim = await send(player, "claimEth", [contest]);
      const after = await publicClient.getBalance({ address: player, blockTag: "latest" });
      expect(after - before + claim.gasUsed * claim.effectiveGasPrice).toBe(stake);
      await expect(send(player, "claimEth", [contest])).rejects.toThrow();
    }
    expect(await publicClient.getBalance({ address: escrow })).toBe(0n);
  }, 30_000);

  it("marks an expired active game cancelled before either player pulls a refund", async () => {
    const contest = keccak256(stringToHex("expired-refund"));
    const stake = parseEther("0.05");
    const latest = await publicClient.getBlock();
    await send(accounts[0], "createContest", [contest, latest.timestamp + 10n], stake);
    await send(accounts[1], "joinContest", [contest], stake);
    await provider.request({ method: "evm_increaseTime", params: [15] });
    await provider.request({ method: "evm_mine", params: [] });
    await send(accounts[1], "refundExpired", [contest]);
    const cancelled = await publicClient.readContract({ address: escrow, abi: artifacts.RobinhoodChessEscrow.abi, functionName: "getContest", args: [contest] }) as { state: number; drawClaims: number };
    expect(cancelled.state).toBe(5);
    expect(cancelled.drawClaims).toBe(0);
    await send(accounts[0], "claimEth", [contest]);
    await send(accounts[1], "claimEth", [contest]);
    const paid = await publicClient.readContract({ address: escrow, abi: artifacts.RobinhoodChessEscrow.abi, functionName: "getContest", args: [contest] }) as { state: number };
    expect(paid.state).toBe(6);
  }, 30_000);
});
