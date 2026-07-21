import { useCallback, useEffect, useState } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

const MINIMUM_LOADING_MS = 250;
const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

interface SolBalanceState {
  balanceSol: number | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useSolBalance(): SolBalanceState {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [balanceSol, setBalanceSol] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!connected || !publicKey) {
      setBalanceSol(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const startedAt = Date.now();
    try {
      await delay(MINIMUM_LOADING_MS);
      const lamports = await connection.getBalance(publicKey, "confirmed");
      setBalanceSol(lamports / LAMPORTS_PER_SOL);
    } catch {
      setBalanceSol(null);
      setError("Balance unavailable");
    } finally {
      const remainingMs = MINIMUM_LOADING_MS - (Date.now() - startedAt);
      if (remainingMs > 0) {
        await delay(remainingMs);
      }
      setLoading(false);
    }
  }, [connected, connection, publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { balanceSol, loading, error, refresh };
}
