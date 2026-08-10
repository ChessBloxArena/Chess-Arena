import { ReactNode, useMemo, useState } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletError } from "@solana/wallet-adapter-base";
import { CoinbaseWalletAdapter } from "@solana/wallet-adapter-coinbase";
import { LedgerWalletAdapter } from "@solana/wallet-adapter-ledger";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { publicPaymentConfig } from "@/lib/paymentConfig";
import { WalletErrorContext } from "./walletErrorContext";
import { DevWalletAdapter } from "./DevWalletAdapter";
import ChessWalletModalProvider from "./ChessWalletModalProvider";

import "@solana/wallet-adapter-react-ui/styles.css";

interface SolanaWalletProviderProps {
  children: ReactNode;
}

export function SolanaWalletProvider({ children }: SolanaWalletProviderProps) {
  const [walletError, setWalletError] = useState<string | null>(null);
  const endpoint = publicPaymentConfig.solana.endpoint;
  const wallets = useMemo(() => {
    const browserWallets = [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new CoinbaseWalletAdapter(),
      new LedgerWalletAdapter(),
    ];

    if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_WALLET === "true") {
      return [new DevWalletAdapter(), ...browserWallets];
    }
    return browserWallets;
  }, []);

  const onError = (error: WalletError) => {
    setWalletError(error.message || "Wallet connection failed");
  };

  const contextValue = useMemo(
    () => ({
      walletError,
      clearWalletError: () => setWalletError(null),
    }),
    [walletError],
  );

  return (
    <WalletErrorContext.Provider value={contextValue}>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} onError={onError} autoConnect={false}>
          <ChessWalletModalProvider>{children}</ChessWalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </WalletErrorContext.Provider>
  );
}
