import type { PaymentConfig } from "./config.js";
import { assertStakeWithinLimits, assertSupportedAsset } from "./assets.js";
import { PaymentSdkError } from "./errors.js";
import {
  deriveContestPda,
  deriveContestVaultPda,
  deriveGameConfigPda,
  deriveGlobalConfigPda,
  deriveVaultAuthorityPda
} from "./pdas.js";

export type PaymentTransactionKind =
  | "create_contest"
  | "join_contest"
  | "cancel_contest"
  | "refund_expired_contest"
  | "settle_contest"
  | "reclaim_contest_rent";

export type GenericContestInput = {
  gameId: string;
  contestId: string;
  assetMint: string;
  stakeAmount: bigint;
  players: string[];
  rulesHash: string;
  expiresAt: number;
};

export type AnchorAccountOverrides = Partial<{
  globalConfig: string;
  gameConfig: string;
  mint: string;
  contest: string;
  contestVault: string;
  vaultAuthority: string;
  creatorTokenAccount: string;
  joinerTokenAccount: string;
  winnerTokenAccount: string;
  creatorRefundTokenAccount: string;
  joinerRefundTokenAccount: string;
  feeTokenAccount: string;
  feeAuthority: string;
  rentRecipient: string;
  tokenProgram: string;
  systemProgram: string;
}>;

export type PaymentInstructionRequest = {
  program: "game_escrow";
  instruction: PaymentTransactionKind;
  accounts: Record<string, string | undefined>;
  args: Record<string, string | number | boolean | string[] | undefined>;
};

export type PaymentTransactionRequest = {
  kind: PaymentTransactionKind;
  gameId: string;
  contestId: string;
  assetMint: string;
  payer: string;
  tokenProgram: string;
  stakeAmount?: bigint;
  instructions: PaymentInstructionRequest[];
};

export type SettleContestInput = {
  gameId: string;
  contestId: string;
  assetMint: string;
  winner?: string;
  resultHash: string;
  resultAuthority: string;
};

export type ReclaimContestRentInput = {
  gameId: string;
  contestId: string;
  assetMint: string;
  rentRecipient: string;
};

export function buildCreateContestTransaction(
  config: PaymentConfig,
  contest: GenericContestInput,
  payer: string,
  accounts: AnchorAccountOverrides = {}
): PaymentTransactionRequest {
  const asset = assertSupportedAsset(config, contest.assetMint);
  assertStakeWithinLimits(config, asset, contest.stakeAmount);
  const anchorAccounts = deriveAnchorAccounts(config, contest, payer, accounts);

  return request(
    "create_contest",
    contest.gameId,
    contest.contestId,
    contest.assetMint,
    payer,
    asset.tokenProgram,
    [
      {
        program: "game_escrow",
        instruction: "create_contest",
        accounts: {
          globalConfig: anchorAccounts.globalConfig,
          gameConfig: anchorAccounts.gameConfig,
          mint: anchorAccounts.mint,
          contest: anchorAccounts.contest,
          contestVault: anchorAccounts.contestVault,
          vaultAuthority: anchorAccounts.vaultAuthority,
          creatorTokenAccount: anchorAccounts.creatorTokenAccount,
          creator: payer,
          tokenProgram: anchorAccounts.tokenProgram,
          systemProgram: anchorAccounts.systemProgram
        },
        args: {
          contest_id: contest.contestId,
          mint: contest.assetMint,
          stake_amount: contest.stakeAmount.toString(),
          rules_hash: contest.rulesHash,
          expires_at: contest.expiresAt
        }
      }
    ],
    contest.stakeAmount
  );
}

export function buildJoinContestTransaction(
  config: PaymentConfig,
  contest: GenericContestInput,
  payer: string,
  accounts: AnchorAccountOverrides = {}
): PaymentTransactionRequest {
  const asset = assertSupportedAsset(config, contest.assetMint);
  assertStakeWithinLimits(config, asset, contest.stakeAmount);
  const anchorAccounts = deriveAnchorAccounts(config, contest, payer, accounts);

  return request(
    "join_contest",
    contest.gameId,
    contest.contestId,
    contest.assetMint,
    payer,
    asset.tokenProgram,
    [
      {
        program: "game_escrow",
        instruction: "join_contest",
        accounts: {
          globalConfig: anchorAccounts.globalConfig,
          gameConfig: anchorAccounts.gameConfig,
          mint: anchorAccounts.mint,
          contest: anchorAccounts.contest,
          contestVault: anchorAccounts.contestVault,
          vaultAuthority: anchorAccounts.vaultAuthority,
          joinerTokenAccount: anchorAccounts.joinerTokenAccount,
          joiner: payer,
          tokenProgram: anchorAccounts.tokenProgram
        },
        args: {}
      }
    ],
    contest.stakeAmount
  );
}

export function buildCancelContestTransaction(
  config: PaymentConfig,
  contest: GenericContestInput,
  payer: string,
  accounts: AnchorAccountOverrides = {}
): PaymentTransactionRequest {
  const asset = assertSupportedAsset(config, contest.assetMint);
  const anchorAccounts = deriveAnchorAccounts(config, contest, payer, accounts);

  return request(
    "cancel_contest",
    contest.gameId,
    contest.contestId,
    contest.assetMint,
    payer,
    asset.tokenProgram,
    [
      {
        program: "game_escrow",
        instruction: "cancel_contest",
        accounts: {
          contest: anchorAccounts.contest,
          mint: anchorAccounts.mint,
          contestVault: anchorAccounts.contestVault,
          vaultAuthority: anchorAccounts.vaultAuthority,
          creatorTokenAccount: anchorAccounts.creatorTokenAccount,
          creator: payer,
          tokenProgram: anchorAccounts.tokenProgram
        },
        args: {}
      }
    ]
  );
}

export function buildRefundExpiredContestTransaction(
  config: PaymentConfig,
  contest: GenericContestInput,
  payer: string,
  accounts: AnchorAccountOverrides = {}
): PaymentTransactionRequest {
  const asset = assertSupportedAsset(config, contest.assetMint);
  const anchorAccounts = deriveAnchorAccounts(config, contest, payer, accounts);

  return request(
    "refund_expired_contest",
    contest.gameId,
    contest.contestId,
    contest.assetMint,
    payer,
    asset.tokenProgram,
    [
      {
        program: "game_escrow",
        instruction: "refund_expired_contest",
        accounts: {
          contest: anchorAccounts.contest,
          mint: anchorAccounts.mint,
          contestVault: anchorAccounts.contestVault,
          vaultAuthority: anchorAccounts.vaultAuthority,
          creatorTokenAccount: anchorAccounts.creatorRefundTokenAccount,
          joinerTokenAccount: anchorAccounts.joinerRefundTokenAccount,
          tokenProgram: anchorAccounts.tokenProgram
        },
        args: {}
      }
    ]
  );
}

export function buildSettleContestTransaction(
  config: PaymentConfig,
  input: SettleContestInput,
  payer: string,
  accounts: AnchorAccountOverrides = {}
): PaymentTransactionRequest {
  const asset = assertSupportedAsset(config, input.assetMint);
  const contest = contestFromSettlement(input);
  const anchorAccounts = deriveAnchorAccounts(config, contest, payer, accounts);

  return request(
    "settle_contest",
    input.gameId,
    input.contestId,
    input.assetMint,
    payer,
    asset.tokenProgram,
    [
      {
        program: "game_escrow",
        instruction: "settle_contest",
        accounts: {
          globalConfig: anchorAccounts.globalConfig,
          gameConfig: anchorAccounts.gameConfig,
          feeAuthority: anchorAccounts.feeAuthority,
          mint: anchorAccounts.mint,
          contest: anchorAccounts.contest,
          contestVault: anchorAccounts.contestVault,
          vaultAuthority: anchorAccounts.vaultAuthority,
          resultAuthority: input.resultAuthority,
          winnerTokenAccount: anchorAccounts.winnerTokenAccount,
          creatorRefundTokenAccount: anchorAccounts.creatorRefundTokenAccount,
          joinerRefundTokenAccount: anchorAccounts.joinerRefundTokenAccount,
          feeTokenAccount: anchorAccounts.feeTokenAccount,
          tokenProgram: anchorAccounts.tokenProgram
        },
        args: {
          winner: input.winner,
          result_hash: input.resultHash
        }
      }
    ]
  );
}

export function buildReclaimContestRentTransaction(
  config: PaymentConfig,
  input: ReclaimContestRentInput,
  payer: string,
  accounts: AnchorAccountOverrides = {}
): PaymentTransactionRequest {
  const asset = assertSupportedAsset(config, input.assetMint);
  const contest = contestFromRentReclaim(input);
  const anchorAccounts = deriveAnchorAccounts(config, contest, payer, {
    ...accounts,
    rentRecipient: accounts.rentRecipient ?? input.rentRecipient,
  });

  return request(
    "reclaim_contest_rent",
    input.gameId,
    input.contestId,
    input.assetMint,
    payer,
    asset.tokenProgram,
    [
      {
        program: "game_escrow",
        instruction: "reclaim_contest_rent",
        accounts: {
          contest: anchorAccounts.contest,
          mint: anchorAccounts.mint,
          contestVault: anchorAccounts.contestVault,
          vaultAuthority: anchorAccounts.vaultAuthority,
          rentRecipient: anchorAccounts.rentRecipient,
          tokenProgram: anchorAccounts.tokenProgram
        },
        args: {}
      }
    ]
  );
}

function deriveAnchorAccounts(
  config: PaymentConfig,
  contest: GenericContestInput,
  payer: string,
  overrides: AnchorAccountOverrides
): Required<AnchorAccountOverrides> {
  const programId = requireEscrowProgramId(config);
  const globalConfig = overrides.globalConfig ?? deriveGlobalConfigPda(programId).publicKey.toBase58();
  const gameConfig =
    overrides.gameConfig ??
    deriveGameConfigPda({ programId, gameId: contest.gameId }).publicKey.toBase58();
  const contestAddress =
    overrides.contest ??
    deriveContestPda({
      programId,
      gameId: contest.gameId,
      contestId: contest.contestId,
      gameConfig
    }).publicKey.toBase58();
  const mint = overrides.mint ?? contest.assetMint;
  const contestVault =
    overrides.contestVault ??
    deriveContestVaultPda({
      programId,
      contest: contestAddress,
      mint
    }).publicKey.toBase58();
  const vaultAuthority =
    overrides.vaultAuthority ??
    deriveVaultAuthorityPda({
      programId,
      contest: contestAddress
    }).publicKey.toBase58();
  const tokenProgram = overrides.tokenProgram ?? tokenProgramIdFor(config, contest.assetMint);

  return {
    globalConfig,
    gameConfig,
    mint,
    contest: contestAddress,
    contestVault,
    vaultAuthority,
    creatorTokenAccount: overrides.creatorTokenAccount ?? "",
    joinerTokenAccount: overrides.joinerTokenAccount ?? "",
    winnerTokenAccount: overrides.winnerTokenAccount ?? "",
    creatorRefundTokenAccount: overrides.creatorRefundTokenAccount ?? overrides.creatorTokenAccount ?? "",
    joinerRefundTokenAccount: overrides.joinerRefundTokenAccount ?? overrides.joinerTokenAccount ?? "",
    feeTokenAccount: overrides.feeTokenAccount ?? "",
    feeAuthority: overrides.feeAuthority ?? config.feeAuthority ?? "",
    rentRecipient: overrides.rentRecipient ?? "",
    tokenProgram,
    systemProgram: overrides.systemProgram ?? "11111111111111111111111111111111"
  };
}

function requireEscrowProgramId(config: PaymentConfig): string {
  if (!config.escrowProgramId) {
    throw new PaymentSdkError(
      "INVALID_CONFIG",
      "Escrow program id is required to build Anchor transaction requests."
    );
  }

  return config.escrowProgramId;
}

function tokenProgramIdFor(config: PaymentConfig, mint: string): string {
  const asset = assertSupportedAsset(config, mint);
  return asset.tokenProgram === "token-2022"
    ? "TokenzQdBNbLqP5VEhdkAS6EPuYzgqFzCjW7JokxX6Sh"
    : "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
}

function contestFromSettlement(input: SettleContestInput): GenericContestInput {
  return {
    gameId: input.gameId,
    contestId: input.contestId,
    assetMint: input.assetMint,
    stakeAmount: 1n,
    players: [],
    rulesHash: "",
    expiresAt: 0
  };
}

function contestFromRentReclaim(input: ReclaimContestRentInput): GenericContestInput {
  return {
    gameId: input.gameId,
    contestId: input.contestId,
    assetMint: input.assetMint,
    stakeAmount: 1n,
    players: [],
    rulesHash: "",
    expiresAt: 0
  };
}

function request(
  kind: PaymentTransactionKind,
  gameId: string,
  contestId: string,
  assetMint: string,
  payer: string,
  tokenProgram: string,
  instructions: PaymentInstructionRequest[],
  stakeAmount?: bigint
): PaymentTransactionRequest {
  return {
    kind,
    gameId,
    contestId,
    assetMint,
    payer,
    tokenProgram,
    stakeAmount,
    instructions
  };
}
