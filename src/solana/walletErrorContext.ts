import { createContext, useContext } from "react";

interface WalletErrorContextValue {
  walletError: string | null;
  clearWalletError: () => void;
}

export const WalletErrorContext = createContext<WalletErrorContextValue>({
  walletError: null,
  clearWalletError: () => {},
});

export function useWalletErrorMessage() {
  return useContext(WalletErrorContext);
}
