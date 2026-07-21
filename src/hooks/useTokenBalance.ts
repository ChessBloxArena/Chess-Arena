import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";

interface UseTokenBalanceArgs {
  owner: PublicKey | null;
  mint: string;
  tokenProgramId: string;
  enabled?: boolean;
}

export interface TokenBalanceState {
  rawAmount: bigint | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

type ParsedTokenAccountEntry = {
  account: {
    owner: PublicKey;
    data: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: {
            amount?: string;
          };
        };
      };
    };
  };
};

function tokenBalanceErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/403|access forbidden|failed to get token accounts/i.test(message)) {
    return "CA balance unavailable. The RPC endpoint rejected the request; please retry in a moment.";
  }
  return "Unable to refresh CA balance.";
}

function rawAmountFromParsedAccount(entry: ParsedTokenAccountEntry, mint: string, tokenProgramId: PublicKey): bigint {
  if (!entry.account.owner.equals(tokenProgramId)) return 0n;
  const info = entry.account.data.parsed?.info;
  if (info?.mint !== mint) return 0n;
  const amount = info.tokenAmount?.amount;
  return amount && /^[0-9]+$/.test(amount) ? BigInt(amount) : 0n;
}

export function useTokenBalance({
  owner,
  mint,
  tokenProgramId,
  enabled = true,
}: UseTokenBalanceArgs): TokenBalanceState {
  const { connection } = useConnection();
  const [rawAmount, setRawAmount] = useState<bigint | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const ownerAddress = owner?.toBase58() ?? null;
  const balanceKey = useMemo(
    () => enabled && ownerAddress ? `${ownerAddress}:${mint}:${tokenProgramId}` : null,
    [enabled, mint, ownerAddress, tokenProgramId],
  );

  const refresh = useCallback(async () => {
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    if (!balanceKey || !owner) {
      setRawAmount(null);
      setLoadedKey(null);
      setError(null);
      return;
    }

    setRefreshing(true);
    setError(null);
    try {
      const mintKey = new PublicKey(mint);
      const tokenProgramKey = new PublicKey(tokenProgramId);
      const accounts = await connection.getParsedTokenAccountsByOwner(
        owner,
        { programId: tokenProgramKey },
        "confirmed",
      );
      const total = (accounts.value as unknown as ParsedTokenAccountEntry[]).reduce(
        (sum, entry) => sum + rawAmountFromParsedAccount(entry, mintKey.toBase58(), tokenProgramKey),
        0n,
      );
      if (requestId.current !== currentRequest) return;
      setRawAmount(total);
      setLoadedKey(balanceKey);
    } catch (err) {
      if (requestId.current !== currentRequest) return;
      setRawAmount(null);
      setLoadedKey(balanceKey);
      setError(tokenBalanceErrorMessage(err));
    } finally {
      if (requestId.current === currentRequest) setRefreshing(false);
    }
  }, [balanceKey, connection, mint, owner, tokenProgramId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    rawAmount,
    loading: Boolean(balanceKey && (refreshing || loadedKey !== balanceKey)),
    refreshing,
    error,
    refresh,
  };
}
