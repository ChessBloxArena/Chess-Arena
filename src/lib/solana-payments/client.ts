import { PublicKey, type Connection } from "@solana/web3.js";
import { assertSupportedAsset, getSupportedAssets } from "./assets.js";
import { formatTokenAmount } from "./amounts.js";
import type { PaymentConfig } from "./config.js";
import { normalizePaymentConfig } from "./config.js";
import { PaymentSdkError } from "./errors.js";
import {
  buildCancelContestTransaction,
  buildCreateContestTransaction,
  buildJoinContestTransaction,
  buildReclaimContestRentTransaction,
  buildRefundExpiredContestTransaction,
  buildSettleContestTransaction,
  type GenericContestInput,
  type PaymentTransactionRequest,
  type ReclaimContestRentInput,
  type SettleContestInput
} from "./transactions.js";

export type TokenBalance = {
  owner: string;
  mint: string;
  rawAmount: bigint;
  decimals: number;
  uiAmount: string;
};

export type PaymentSimulationResult = {
  ok: boolean;
  logs: string[];
  error?: string;
};

export type PaymentAdapter = {
  getSolBalance(owner: string): Promise<bigint>;
  getTokenBalance(owner: string, mint: string): Promise<TokenBalance | undefined>;
  simulateTransactionRequest?(
    request: PaymentTransactionRequest
  ): Promise<PaymentSimulationResult>;
};

export type SolanaPaymentClient = ReturnType<typeof createSolanaPaymentClient>;

export function createSolanaPaymentClient(input: {
  config: PaymentConfig;
  adapter: PaymentAdapter;
}) {
  const config = normalizePaymentConfig(input.config);

  return {
    getPaymentConfig: () => config,
    getSupportedAssets: () => getSupportedAssets(config),
    getSolBalance: (owner: string) => input.adapter.getSolBalance(owner),
    getTokenBalance: async (owner: string, mint: string) => {
      assertSupportedAsset(config, mint);
      return input.adapter.getTokenBalance(owner, mint);
    },
    buildCreateContestTransaction: (contest: GenericContestInput, payer: string) =>
      buildCreateContestTransaction(config, contest, payer),
    buildJoinContestTransaction: (contest: GenericContestInput, payer: string) =>
      buildJoinContestTransaction(config, contest, payer),
    buildCancelContestTransaction: (contest: GenericContestInput, payer: string) =>
      buildCancelContestTransaction(config, contest, payer),
    buildRefundExpiredContestTransaction: (
      contest: GenericContestInput,
      payer: string
    ) => buildRefundExpiredContestTransaction(config, contest, payer),
    buildSettleContestTransaction: (settlement: SettleContestInput, payer: string) =>
      buildSettleContestTransaction(config, settlement, payer),
    buildReclaimContestRentTransaction: (reclaim: ReclaimContestRentInput, payer: string) =>
      buildReclaimContestRentTransaction(config, reclaim, payer),
    simulatePaymentTransaction: (request: PaymentTransactionRequest) =>
      simulatePaymentTransaction(input.adapter, request)
  };
}

export async function simulatePaymentTransaction(
  adapter: PaymentAdapter,
  request: PaymentTransactionRequest
): Promise<PaymentSimulationResult> {
  if (!adapter.simulateTransactionRequest) {
    return {
      ok: true,
      logs: [`mock simulation accepted ${request.kind}`]
    };
  }

  return adapter.simulateTransactionRequest(request);
}

export function createMockPaymentAdapter(input: {
  solBalances?: Record<string, bigint>;
  tokenBalances?: Record<string, TokenBalance>;
  simulations?: Record<string, PaymentSimulationResult>;
} = {}): PaymentAdapter {
  return {
    async getSolBalance(owner) {
      return input.solBalances?.[owner] ?? 0n;
    },
    async getTokenBalance(owner, mint) {
      return input.tokenBalances?.[balanceKey(owner, mint)];
    },
    async simulateTransactionRequest(request) {
      return (
        input.simulations?.[request.kind] ?? {
          ok: true,
          logs: [`mock simulation accepted ${request.kind}`]
        }
      );
    }
  };
}

export function createWeb3PaymentAdapter(connection: Pick<
  Connection,
  "getBalance" | "getParsedTokenAccountsByOwner"
>): PaymentAdapter {
  return {
    async getSolBalance(owner) {
      return BigInt(await connection.getBalance(new PublicKey(owner)));
    },
    async getTokenBalance(owner, mint) {
      const ownerKey = new PublicKey(owner);
      const mintKey = new PublicKey(mint);
      const tokenProgramIds = [
        new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPuYzgqFzCjW7JokxX6Sh")
      ];

      for (const programId of tokenProgramIds) {
        const accounts = await connection.getParsedTokenAccountsByOwner(ownerKey, {
          mint: mintKey,
          programId
        });
        const firstAccount = accounts.value[0];
        const parsedInfo = firstAccount?.account.data.parsed.info;
        const tokenAmount = parsedInfo?.tokenAmount;

        if (tokenAmount?.amount !== undefined && tokenAmount.decimals !== undefined) {
          const rawAmount = BigInt(tokenAmount.amount);
          const decimals = Number(tokenAmount.decimals);
          return {
            owner,
            mint,
            rawAmount,
            decimals,
            uiAmount: formatTokenAmount(rawAmount, decimals, {
              trimTrailingZeros: true
            })
          };
        }
      }

      return undefined;
    }
  };
}

export function createTokenBalance(input: {
  owner: string;
  mint: string;
  rawAmount: bigint;
  decimals: number;
}): TokenBalance {
  return {
    ...input,
    uiAmount: formatTokenAmount(input.rawAmount, input.decimals, {
      trimTrailingZeros: true
    })
  };
}

function balanceKey(owner: string, mint: string): string {
  return `${owner}:${mint}`;
}

export function assertBalanceAvailable(balance: TokenBalance | undefined): TokenBalance {
  if (!balance) {
    throw new PaymentSdkError("BALANCE_UNAVAILABLE", "Token balance is unavailable.");
  }

  return balance;
}
