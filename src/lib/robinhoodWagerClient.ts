import { automaticRblxAbi } from "../../supabase/functions/_shared/automaticRblx.mjs";
import type { PayoutAuthorization, PayoutReviewRequest } from "./automaticRblx";
import { readPendingRobinhoodWager, savePendingRobinhoodWager } from "./robinhoodPendingWager";
import { validateRblxQuote } from "./rblxQuoteValidation";
import type { Address, Hash, Hex } from "viem";
import {
  confirmWagerDeposit,
  invokeWagerReferee,
  prepareWagerLobby,
  prepareWagerLobbyJoin,
  prepareWagerQueue,
  signWalletProof,
  type PrepareWagerQueueResponse,
} from "@/lib/wagerRefereeClient";
import {
  robinhoodChessEscrowAbi,
  robinhoodContestKey,
  robinhoodEscrowAddress,
  robinhoodEntryEscrowAddress,
  automaticRblxPayoutEnabled,
  gameEscrowAddress,
} from "@/lib/robinhoodChain";

export interface RobinhoodWalletActions {
  address: Address;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  writeContract: (request: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
  }) => Promise<Hash>;
  sendTransaction?: (request: {
    to: Address;
    data: Hex;
    value: bigint;
    operationId?: string;
  }) => Promise<Hash>;
}

export interface EnterRobinhoodWagerArgs extends RobinhoodWalletActions {
  sessionId: string;
  stakeWei: bigint;
  timeControl?: string;
  onPrepared?: (prepared: PrepareWagerQueueResponse) => void;
  payoutAuthorization?: PayoutAuthorization;
  reviewPayout?: (request: PayoutReviewRequest) => Promise<PayoutAuthorization | undefined>;
}

export interface RobinhoodWagerEntry {
  gameId: string;
  color: "w" | "b";
  playerToken: string;
  signature: Hash;
  escrowAddress?: string;
}

function configuredEscrow(): Address {
  const address = robinhoodEntryEscrowAddress();
  if (!address) throw new Error("Robinhood wager escrow is not configured.");
  return address;
}

function expiryTimestamp(): bigint {
  const configured = Number(import.meta.env.VITE_WAGER_CONTEST_TTL_SECONDS || 86_400);
  const ttl = Number.isFinite(configured) ? Math.min(Math.max(Math.floor(configured), 600), 2_592_000) : 86_400;
  return BigInt(Math.floor(Date.now() / 1000) + ttl);
}

async function confirmWithRetry(prepared: PrepareWagerQueueResponse, args: EnterRobinhoodWagerArgs, hash: Hash) {
  let lastError: unknown;
  for (const delay of [0, 1_000, 2_000, 4_000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await confirmWagerDeposit({
        gameId: prepared.gameId,
        sessionId: args.sessionId,
        playerToken: prepared.playerToken,
        color: prepared.color,
        transactionSignature: hash,
        walletAddress: args.address,
        assetMint: prepared.assetMint,
        stakeLamports: BigInt(prepared.stakeLamports),
        escrowContestId: prepared.contestId,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function submitPrepared(
  prepared: PrepareWagerQueueResponse,
  args: EnterRobinhoodWagerArgs,
): Promise<RobinhoodWagerEntry> {
  const escrow = gameEscrowAddress(prepared.escrowAddress, prepared.payoutMode);
  if (BigInt(prepared.stakeLamports) !== args.stakeWei) {
    throw new Error("This match's stake differs from the amount you reviewed. No payment was requested. Ask the host for a new invite.");
  }
  let pending = readPendingRobinhoodWager(escrow, args.address);
  const automatic = prepared.payoutMode === "automatic_rblx";
  if (args.payoutAuthorization && !automatic) throw new Error("Payout mode changed after your review. No deposit was requested.");
  if (automatic && (!prepared.minimumRblxOut || !/^[1-9][0-9]*$/.test(prepared.minimumRblxOut))) throw new Error("Missing automatic payout minimum");
  if (automatic && !pending && (!args.payoutAuthorization?.accepted || args.payoutAuthorization.quote.minimumRblxOut !== prepared.minimumRblxOut
    || args.payoutAuthorization.quote.escrowAddress.toLowerCase() !== escrow.toLowerCase()
    || args.payoutAuthorization.quote.walletAddress.toLowerCase() !== args.address.toLowerCase())) throw new Error("Prepared payout differs from your authorization. No deposit was requested.");
  if (pending && pending.prepared.gameId !== prepared.gameId) throw new Error("Recover your previous wager from My funds first.");
  if (!pending) {
    pending = { version: 1, prepared, sessionId: args.sessionId, walletAddress: args.address, expiresAt: expiryTimestamp().toString() };
    savePendingRobinhoodWager(escrow, pending);
  }
  args.onPrepared?.(prepared);
  const stakeWei = BigInt(prepared.stakeLamports);
  const hash = await args.writeContract({
    address: escrow,
    abi: automatic ? automaticRblxAbi : robinhoodChessEscrowAbi,
    functionName: prepared.depositRole === "white" ? (automatic ? "createRblxContest" : "createContest") : (automatic ? "joinRblxContest" : "joinContest"),
    args: automatic
      ? (prepared.depositRole === "white" ? [robinhoodContestKey(prepared.contestId), BigInt(pending.expiresAt), BigInt(prepared.minimumRblxOut!)] : [robinhoodContestKey(prepared.contestId), BigInt(prepared.minimumRblxOut!)])
      : (prepared.depositRole === "white" ? [robinhoodContestKey(prepared.contestId), BigInt(pending.expiresAt)] : [robinhoodContestKey(prepared.contestId)]),
    value: stakeWei,
  });
  await confirmWithRetry(prepared, args, hash);
  return { gameId: prepared.gameId, color: prepared.color, playerToken: prepared.playerToken, signature: hash, escrowAddress: escrow };
}

function prepareInput(args: EnterRobinhoodWagerArgs, walletProof: Awaited<ReturnType<typeof signWalletProof>>) {
  return {
    sessionId: args.sessionId,
    walletAddress: args.address,
    assetMint: "0x0000000000000000000000000000000000000000",
    tokenProgramId: "",
    stakeLamports: args.stakeWei,
    paymentMode: "robinhood_eth_escrow" as const,
    timeControl: args.timeControl,
    payoutAuthorization: args.payoutAuthorization ? { token: args.payoutAuthorization.token, accepted: args.payoutAuthorization.accepted } : undefined,
    ...walletProof,
  };
}

async function resumePending(args: EnterRobinhoodWagerArgs, expectedGameId?: string): Promise<RobinhoodWagerEntry | null> {
  const pending = readPendingRobinhoodWager(configuredEscrow(), args.address) ?? (robinhoodEscrowAddress() && readPendingRobinhoodWager(robinhoodEscrowAddress()!, args.address));
  if (!pending) return null;
  if (expectedGameId && pending.prepared.gameId !== expectedGameId) throw new Error("Recover your previous wager from My funds first.");
  if (pending.sessionId !== args.sessionId) throw new Error("Your session changed. Open My funds to recover the match with your wallet.");
  if (pending.prepared.stakeLamports !== args.stakeWei.toString()) throw new Error("An unfinished wager is saved. Open My funds before changing the stake.");
  return submitPrepared(pending.prepared, args);
}

async function authorizeEntry(args: EnterRobinhoodWagerArgs, gameId?: string): Promise<EnterRobinhoodWagerArgs> {
  if (gameId && args.reviewPayout) {
    const response = await invokeWagerReferee<{ payoutMode: string; stakeRaw: string }>({ action: "get_robinhood_payout_mode", gameId });
    if (response.stakeRaw !== args.stakeWei.toString()) throw new Error("Invite stake differs from the match. No deposit was requested.");
    if (response.payoutMode !== "automatic_rblx") return args;
  } else if (!automaticRblxPayoutEnabled()) return args;
  if (!args.reviewPayout) throw new Error("Review the automatic RBLX payout before depositing.");
  return { ...args, payoutAuthorization: await args.reviewPayout({ walletAddress: args.address, stakeWei: args.stakeWei, gameId, signMessage: args.signMessage }) };
}

export async function enterRobinhoodWagerQueue(args: EnterRobinhoodWagerArgs): Promise<RobinhoodWagerEntry> {
  configuredEscrow();
  const resumed = await resumePending(args);
  if (resumed) return resumed;
  args = await authorizeEntry(args);
  const proof = await signWalletProof({
    action: "prepare_wager_queue",
    sessionId: args.sessionId,
    walletAddress: args.address,
    signMessage: args.signMessage,
  });
  return submitPrepared(await prepareWagerQueue(prepareInput(args, proof)), args);
}

export async function hostRobinhoodWagerLobby(args: EnterRobinhoodWagerArgs): Promise<RobinhoodWagerEntry> {
  configuredEscrow();
  const resumed = await resumePending(args);
  if (resumed) return resumed;
  args = await authorizeEntry(args);
  const proof = await signWalletProof({
    action: "prepare_wager_lobby",
    sessionId: args.sessionId,
    walletAddress: args.address,
    signMessage: args.signMessage,
  });
  return submitPrepared(await prepareWagerLobby(prepareInput(args, proof)), args);
}

export async function joinRobinhoodWagerLobby(
  gameId: string,
  args: EnterRobinhoodWagerArgs,
): Promise<RobinhoodWagerEntry> {
  configuredEscrow();
  const pending = readPendingRobinhoodWager(configuredEscrow(), args.address);
  if (pending && pending.prepared.gameId !== gameId) throw new Error("Recover your previous wager from My funds first.");
  const resumed = await resumePending(args, gameId);
  if (resumed) return resumed;
  args = await authorizeEntry(args, gameId);
  const proof = await signWalletProof({
    action: "prepare_black_deposit",
    sessionId: args.sessionId,
    gameId,
    walletAddress: args.address,
    signMessage: args.signMessage,
  });
  const prepared = await prepareWagerLobbyJoin({ ...prepareInput(args, proof), gameId });
  const game = prepared.game ?? {};
  return submitPrepared({
    ...prepared,
    depositRole: "black",
    contestId: typeof game.escrow_contest_id === "string" ? game.escrow_contest_id : prepared.contestId,
    stakeLamports: typeof game.wager_stake_raw === "string" ? game.wager_stake_raw : prepared.stakeLamports,
    assetMint: typeof game.wager_asset_mint === "string" ? game.wager_asset_mint : prepared.assetMint,
  }, args);
}

export async function cancelRobinhoodWager(args: {
  gameId: string;
  sessionId: string;
  playerToken: string;
  contestId: string;
  stakeWei: bigint;
  assetMint: string;
  wallet: RobinhoodWalletActions;
  escrowAddress?: string | null;
}) {
  const hash = await args.wallet.writeContract({
    address: gameEscrowAddress(args.escrowAddress),
    abi: robinhoodChessEscrowAbi,
    functionName: "cancelUnmatched",
    args: [robinhoodContestKey(args.contestId)],
  });
  const proof = await signWalletProof({
    action: "cancel_wager_waiting",
    sessionId: args.sessionId,
    gameId: args.gameId,
    walletAddress: args.wallet.address,
    signMessage: args.wallet.signMessage,
  });
  return invokeWagerReferee<{ ok: boolean; game?: Record<string, unknown> }>({
    action: "cancel_wager_waiting",
    gameId: args.gameId,
    sessionId: args.sessionId,
    playerToken: args.playerToken,
    walletAddress: args.wallet.address,
    assetMint: args.assetMint,
    stakeRaw: args.stakeWei.toString(),
    escrowContestId: args.contestId,
    transactionSignature: hash,
    paymentMode: "robinhood_eth_escrow",
    ...proof,
  });
}

export async function refundExpiredRobinhoodWager(args: {
  gameId: string;
  sessionId: string;
  playerToken: string;
  contestId: string;
  stakeWei: bigint;
  assetMint: string;
  wallet: RobinhoodWalletActions;
  escrowAddress?: string | null;
}) {
  const hash = await args.wallet.writeContract({
    address: gameEscrowAddress(args.escrowAddress),
    abi: robinhoodChessEscrowAbi,
    functionName: "refundExpired",
    args: [robinhoodContestKey(args.contestId)],
  });
  const proof = await signWalletProof({
    action: "request_wager_refund",
    sessionId: args.sessionId,
    gameId: args.gameId,
    walletAddress: args.wallet.address,
    signMessage: args.wallet.signMessage,
  });
  return invokeWagerReferee<{ ok: boolean; game?: Record<string, unknown> }>({
    action: "request_wager_refund",
    gameId: args.gameId,
    sessionId: args.sessionId,
    playerToken: args.playerToken,
    walletAddress: args.wallet.address,
    assetMint: args.assetMint,
    stakeRaw: args.stakeWei.toString(),
    escrowContestId: args.contestId,
    transactionSignature: hash,
    paymentMode: "robinhood_eth_escrow",
    ...proof,
  });
}

export async function claimRobinhoodEth(contestId: string, wallet: RobinhoodWalletActions, escrowAddress?: string | null): Promise<Hash> {
  return wallet.writeContract({
    address: gameEscrowAddress(escrowAddress),
    abi: robinhoodChessEscrowAbi,
    functionName: "claimEth",
    args: [robinhoodContestKey(contestId)],
  });
}

export interface RblxSwapQuote {
  gameId: string;
  claimTransactionHash: Hash;
  walletAddress: Address;
  estimatedGasWei?: string;
  slippageBps: number;
  transaction: {
    to: Address;
    data: Hex;
    value: string;
    chainId: number;
  };
  minimumRblxOut: string;
  quotedRblxOut: string;
  expiresAt: string;
  kycUrl?: string | null;
}

export async function getRobinhoodRblxQuote(args: {
  gameId: string;
  playerToken: string;
  claimTransactionHash: Hash;
  expectedPrizeWei: bigint;
  wallet: RobinhoodWalletActions;
}): Promise<RblxSwapQuote> {
  const proof = await signWalletProof({
    action: "get_rblx_swap_quote",
    gameId: args.gameId,
    walletAddress: args.wallet.address,
    signMessage: args.wallet.signMessage,
  });
  const quote = await invokeWagerReferee<RblxSwapQuote>({
    action: "get_rblx_swap_quote",
    gameId: args.gameId,
    playerToken: args.playerToken,
    walletAddress: args.wallet.address,
    claimTransactionHash: args.claimTransactionHash,
    uniswapTermsAccepted: true,
    ...proof,
  });
  validateRblxQuote(quote, args.expectedPrizeWei, Date.now(), args.wallet.address);
  return quote;
}

export async function swapRobinhoodPrizeForRblx(args: {
  gameId: string;
  claimTransactionHash: Hash;
  expectedPrizeWei: bigint;
  quote: RblxSwapQuote;
  wallet: RobinhoodWalletActions;
}): Promise<{ hash: Hash; quote: RblxSwapQuote }> {
  if (!args.wallet.sendTransaction) throw new Error("This wallet cannot send the Uniswap swap transaction.");
  const { quote } = args;
  if (quote.gameId !== args.gameId || quote.claimTransactionHash !== args.claimTransactionHash) throw new Error("This quote belongs to another prize. Request a new quote.");
  validateRblxQuote(quote, args.expectedPrizeWei, Date.now(), args.wallet.address);
  const hash = await args.wallet.sendTransaction({
    to: quote.transaction.to,
    data: quote.transaction.data,
    value: BigInt(quote.transaction.value),
    operationId: `rblx:${args.gameId}`,
  });
  return { hash, quote };
}
