import { useCallback, useEffect, useState } from "react";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SendTransactionError,
  Transaction,
  type BlockhashWithExpiryBlockHeight,
  type Commitment,
  type Connection,
  type TransactionSignature,
} from "@solana/web3.js";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { publicPaymentConfig } from "@/lib/paymentConfig";

export interface SolanaWalletState {
  providerDetected: boolean;
  publicKey: PublicKey | null;
  address: string | null;
  shortAddress: string | null;
  balanceLamports: bigint | null;
  balanceSol: number | null;
  connecting: boolean;
  refreshing: boolean;
  error: string | null;
  connect: () => Promise<PublicKey | null>;
  disconnect: () => Promise<void>;
  refreshBalance: (wallet?: PublicKey | null) => Promise<void>;
  signAndSendTransaction: (transaction: Transaction) => Promise<string>;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
}

function shortAddress(address: string | null): string | null {
  return address ? `${address.slice(0, 4)}...${address.slice(-4)}` : null;
}

function balanceErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/403|access forbidden|failed to get balance/i.test(message)) {
    return "SOL balance unavailable. The RPC endpoint rejected the request; please retry in a moment.";
  }
  return "Unable to refresh SOL balance";
}

function isBlockhashExpiredError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /block height exceeded|blockhash not found|has expired|transaction expired/i.test(message);
}

function cleanTransactionMessage(message: string): string {
  return message
    .replace(/\s*Catch the `SendTransactionError` and call `getLogs\(\)` on it for full details\.\s*/gi, "")
    .replace(/^Simulation failed\.\s*Message:\s*/i, "")
    .trim();
}

async function transactionLogs(err: unknown, connection: Connection): Promise<string[]> {
  if (!(err instanceof SendTransactionError)) return [];
  const cachedLogs = err.transactionError.logs ?? err.logs;
  if (cachedLogs?.length) return cachedLogs;
  try {
    return await err.getLogs(connection);
  } catch {
    return [];
  }
}

function isAnchorInstructionFallback(message: string, logs: string[]): boolean {
  const details = `${message}\n${logs.join("\n")}`;
  return /custom program error:\s*0x65|InstructionFallbackNotFound|Error Number:\s*101|Fallback functions are not supported/i.test(details);
}

function isEscrowFundingFailure(message: string, logs: string[]): boolean {
  const details = `${message}\n${logs.join("\n")}`;
  if (/insufficient funds|insufficient lamports|Attempt to debit an account but found no record of a prior credit/i.test(details)) {
    return true;
  }

  return /Program 11111111111111111111111111111111 failed: custom program error:\s*0x1/i.test(details);
}

export async function transactionErrorMessage(err: unknown, connection: Connection): Promise<string> {
  if (isBlockhashExpiredError(err)) {
    return "Transaction expired before confirmation. Trust this site in your wallet, then start the wager again.";
  }
  const message = err instanceof Error ? err.message : String(err);
  const logs = await transactionLogs(err, connection);

  if (isAnchorInstructionFallback(message, logs)) {
    return "The wager escrow program on-chain does not recognize this sponsored wager instruction. Wagers need to be paused until the deployed escrow program is upgraded or the configured program id is corrected.";
  }

  if (isEscrowFundingFailure(message, logs)) {
    return `Insufficient SOL on ${publicPaymentConfig.solana.clusterLabel} for this wager. Check that your wallet is funded on the app's selected Solana network, then refresh balance or try a smaller stake.`;
  }

  return cleanTransactionMessage(message) || "Transaction failed";
}

function cloneTransactionForWallet(original: Transaction, feePayer: PublicKey): Transaction {
  const transaction = new Transaction();
  transaction.feePayer = original.feePayer ?? feePayer;
  for (const instruction of original.instructions) {
    transaction.add(instruction);
  }
  return transaction;
}

export function hasExternalPresignature(transaction: Transaction, walletPublicKey: PublicKey): boolean {
  return transaction.signatures.some(({ publicKey, signature }) =>
    signature !== null && !publicKey.equals(walletPublicKey)
  );
}

export function prepareTransactionForWalletSend(
  transaction: Transaction,
  walletPublicKey: PublicKey,
  latestBlockhash?: BlockhashWithExpiryBlockHeight,
): {
  transaction: Transaction;
  latestBlockhash: BlockhashWithExpiryBlockHeight | null;
  preservesExternalSignature: boolean;
} {
  if (hasExternalPresignature(transaction, walletPublicKey)) {
    return {
      transaction,
      latestBlockhash:
        transaction.recentBlockhash && transaction.lastValidBlockHeight
          ? {
            blockhash: transaction.recentBlockhash,
            lastValidBlockHeight: transaction.lastValidBlockHeight,
          }
          : null,
      preservesExternalSignature: true,
    };
  }

  if (!latestBlockhash) {
    throw new Error("Missing recent blockhash for wallet transaction.");
  }
  const cloned = cloneTransactionForWallet(transaction, walletPublicKey);
  cloned.recentBlockhash = latestBlockhash.blockhash;
  cloned.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
  return {
    transaction: cloned,
    latestBlockhash,
    preservesExternalSignature: false,
  };
}

const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export function useSolanaWallet(): SolanaWalletState {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const publicKey = wallet.publicKey ?? null;
  const [balanceLamports, setBalanceLamports] = useState<bigint | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectAfterSelection, setConnectAfterSelection] = useState(false);
  const [selectionResetPending, setSelectionResetPending] = useState(false);
  const providerDetected = wallet.wallets.some(({ readyState }) =>
    readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable
  );

  const selectedWallet = wallet.wallet;
  const selectedWalletReady =
    selectedWallet?.readyState === WalletReadyState.Installed ||
    selectedWallet?.readyState === WalletReadyState.Loadable;

  const refreshBalance = useCallback(async (wallet = publicKey) => {
    if (!wallet || !connection) {
      setBalanceLamports(null);
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const lamports = await connection.getBalance(wallet, "confirmed");
      setBalanceLamports(BigInt(lamports));
    } catch (err) {
      setBalanceLamports(null);
      setError(balanceErrorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }, [connection, publicKey]);

  const connectSelectedWallet = useCallback(async () => {
    if (!selectedWallet) {
      setConnectAfterSelection(true);
      setVisible(true);
      return null;
    }

    if (!selectedWalletReady) {
      setConnectAfterSelection(true);
      setVisible(true);
      setError(`${selectedWallet.adapter.name} wallet not detected. Install or unlock it, then try again.`);
      return null;
    }

    setError(null);
    try {
      await wallet.connect();
      const connectedPublicKey = selectedWallet.adapter.publicKey ?? wallet.publicKey ?? null;
      await refreshBalance(connectedPublicKey);
      setConnectAfterSelection(false);
      return connectedPublicKey;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet connection rejected");
      return null;
    }
  }, [refreshBalance, selectedWallet, selectedWalletReady, setVisible, wallet]);

  const connect = useCallback(async () => {
    setError(null);
    setConnectAfterSelection(true);
    setSelectionResetPending(true);
    wallet.select(null);
    setVisible(true);
    return null;
  }, [setVisible, wallet]);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await wallet.disconnect();
    } finally {
      setBalanceLamports(null);
    }
  }, [wallet]);

  const signAndSendTransaction = useCallback(async (transaction: Transaction): Promise<string> => {
    if (!wallet.publicKey || !wallet.sendTransaction) throw new Error("Connect a wallet before signing.");

    const signatureLanded = async (signature: TransactionSignature): Promise<boolean> => {
      const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = value[0];
      if (!status) return false;
      if (status.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      return status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized";
    };

    const waitForConfirmation = async (
      signature: TransactionSignature,
      latestBlockhash: BlockhashWithExpiryBlockHeight | null,
      commitment: Commitment = "confirmed",
    ): Promise<void> => {
      const deadlineMs = Date.now() + 90_000;
      while (true) {
        const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
        const status = value[0];
        if (status?.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
        }
        if (status?.confirmationStatus === commitment || status?.confirmationStatus === "finalized") {
          return;
        }

        if (latestBlockhash) {
          const blockHeight = await connection.getBlockHeight("processed");
          if (blockHeight > latestBlockhash.lastValidBlockHeight) {
            throw new Error("Transaction expired before confirmation");
          }
        } else if (Date.now() > deadlineMs) {
          throw new Error("Transaction expired before confirmation");
        }
        await delay(900);
      }
    };

    const sendSignedTransaction = async (
      signedTransaction: Transaction,
      latestBlockhash: BlockhashWithExpiryBlockHeight | null,
    ): Promise<TransactionSignature> => {
      const rawTransaction = signedTransaction.serialize();
      let signature: TransactionSignature | null = null;
      let lastSendError: unknown = null;
      const deadlineMs = Date.now() + 90_000;

      while (true) {
        if (latestBlockhash) {
          const blockHeight = await connection.getBlockHeight("processed");
          if (blockHeight > latestBlockhash.lastValidBlockHeight) {
            if (signature && await signatureLanded(signature)) return signature;
            throw lastSendError ?? new Error("Transaction expired before confirmation");
          }
        } else if (Date.now() > deadlineMs) {
          if (signature && await signatureLanded(signature)) return signature;
          throw lastSendError ?? new Error("Transaction expired before confirmation");
        }

        try {
          signature = await connection.sendRawTransaction(rawTransaction, {
            maxRetries: 5,
            preflightCommitment: "processed",
            skipPreflight: Boolean(signature),
          });
        } catch (err) {
          lastSendError = err;
          if (signature && await signatureLanded(signature)) return signature;
          if (!isBlockhashExpiredError(err) && !/already been processed|already processed/i.test(String(err))) {
            throw err;
          }
        }

        if (signature && await signatureLanded(signature)) return signature;
        await delay(1_200);
      }
    };

    const latestBlockhash = hasExternalPresignature(transaction, wallet.publicKey)
      ? undefined
      : await connection.getLatestBlockhash("processed");
    const preparedTransaction = prepareTransactionForWalletSend(transaction, wallet.publicKey, latestBlockhash);
    const attemptTransaction = preparedTransaction.transaction;

    let signature: TransactionSignature | null = null;
    try {
      if (wallet.signTransaction) {
        const signedTransaction = await wallet.signTransaction(attemptTransaction);
        signature = await sendSignedTransaction(signedTransaction, preparedTransaction.latestBlockhash);
      } else if (preparedTransaction.preservesExternalSignature) {
        throw new Error("This wallet cannot co-sign sponsored wager transactions.");
      } else {
        signature = await wallet.sendTransaction(attemptTransaction, connection, {
          maxRetries: 10,
          preflightCommitment: "processed",
        });
      }
      await waitForConfirmation(signature, preparedTransaction.latestBlockhash);
      return signature;
    } catch (err) {
      if (signature && isBlockhashExpiredError(err) && await signatureLanded(signature)) {
        return signature;
      }
      throw new Error(await transactionErrorMessage(err, connection));
    }
  }, [connection, wallet]);

  const signMessage = useCallback(async (message: Uint8Array): Promise<Uint8Array> => {
    if (!wallet.publicKey || !wallet.signMessage) {
      throw new Error("Connect a wallet that supports message signing.");
    }
    return wallet.signMessage(message);
  }, [wallet]);

  useEffect(() => {
    void refreshBalance(publicKey);
  }, [publicKey, refreshBalance]);

  useEffect(() => {
    if (!connectAfterSelection || publicKey) return;
    if (selectionResetPending) {
      if (selectedWallet) return;
      setSelectionResetPending(false);
      return;
    }
    if (!selectedWallet) return;

    if (!selectedWalletReady) {
      setError(`${selectedWallet.adapter.name} wallet not detected. Install or unlock it, then try again.`);
      return;
    }

    void connectSelectedWallet();
  }, [
    connectAfterSelection,
    connectSelectedWallet,
    publicKey,
    selectedWallet,
    selectedWalletReady,
    selectionResetPending,
  ]);

  const address = publicKey?.toBase58() ?? null;

  return {
    providerDetected,
    publicKey,
    address,
    shortAddress: shortAddress(address),
    balanceLamports,
    balanceSol: balanceLamports == null ? null : Number(balanceLamports) / LAMPORTS_PER_SOL,
    connecting: wallet.connecting,
    refreshing,
    error,
    connect,
    disconnect,
    refreshBalance,
    signAndSendTransaction,
    signMessage: wallet.signMessage ? signMessage : undefined,
  };
}
