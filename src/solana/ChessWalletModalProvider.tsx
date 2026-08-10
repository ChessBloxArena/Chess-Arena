import { useWallet, type Wallet } from "@solana/wallet-adapter-react";
import { WalletIcon, WalletModalContext } from "@solana/wallet-adapter-react-ui";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { ReactNode, useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";

interface ChessWalletModalProviderProps {
  children: ReactNode;
}

const WALLET_ORDER = [
  "MetaMask",
  "Phantom",
  "Solflare",
  "Coinbase Wallet",
  "Ledger",
  "Solscan",
];

function walletPriority(wallet: Wallet): number {
  const index = WALLET_ORDER.findIndex((name) => wallet.adapter.name.toLowerCase().includes(name.toLowerCase()));
  return index === -1 ? WALLET_ORDER.length : index;
}

function readyStateLabel(readyState: WalletReadyState): string {
  if (readyState === WalletReadyState.Installed) return "DETECTED";
  if (readyState === WalletReadyState.Loadable) return "READY";
  if (readyState === WalletReadyState.Unsupported) return "UNSUPPORTED";
  return "INSTALL";
}

function readyStateClass(readyState: WalletReadyState): string {
  if (readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable) return "is-ready";
  if (readyState === WalletReadyState.Unsupported) return "is-unsupported";
  return "is-install";
}

function uniqueSortedWallets(wallets: Wallet[]): Wallet[] {
  const byName = new Map<string, Wallet>();

  for (const wallet of wallets) {
    const key = wallet.adapter.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || wallet.readyState === WalletReadyState.Installed) {
      byName.set(key, wallet);
    }
  }

  return [...byName.values()].sort((a, b) => {
    const priority = walletPriority(a) - walletPriority(b);
    if (priority !== 0) return priority;

    const readyDiff = Number(b.readyState === WalletReadyState.Installed) - Number(a.readyState === WalletReadyState.Installed);
    if (readyDiff !== 0) return readyDiff;

    return a.adapter.name.localeCompare(b.adapter.name);
  });
}

function ChessWalletModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { select, wallets } = useWallet();
  const listedWallets = useMemo(() => uniqueSortedWallets(wallets), [wallets]);

  const handleWalletClick = (event: MouseEvent<HTMLButtonElement>, walletName: WalletName) => {
    event.preventDefault();
    select(walletName);
    onClose();
  };

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      aria-labelledby="wallet-adapter-modal-title"
      aria-modal="true"
      className="wallet-adapter-modal wallet-adapter-modal-fade-in chess-wallet-modal"
      role="dialog"
    >
      <div className="wallet-adapter-modal-container">
        <div className="wallet-adapter-modal-wrapper chess-wallet-modal-wrapper">
          <button
            aria-label="Close wallet picker"
            className="wallet-adapter-modal-button-close"
            onClick={onClose}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M14 12.461 8.3 6.772l5.234-5.233L12.006 0 6.772 5.234 1.54 0 0 1.539l5.234 5.233L0 12.006l1.539 1.528L6.772 8.3l5.69 5.7L14 12.461z" />
            </svg>
          </button>

          <h1 className="wallet-adapter-modal-title" id="wallet-adapter-modal-title">
            CONNECT SOLANA WALLET
          </h1>

          <p className="chess-wallet-modal-subtitle">
            WAGERS USE SOLANA SIGNING. EVM-ONLY WALLETS ARE NOT USED HERE.
          </p>

          <ul className="wallet-adapter-modal-list chess-wallet-modal-list">
            {listedWallets.map((wallet) => (
              <li key={wallet.adapter.name}>
                <button
                  className="wallet-adapter-button chess-wallet-option"
                  onClick={(event) => handleWalletClick(event, wallet.adapter.name)}
                  type="button"
                >
                  <span className="wallet-adapter-button-start-icon">
                    <WalletIcon wallet={wallet} />
                  </span>
                  <span className="chess-wallet-option-name">{wallet.adapter.name}</span>
                  <span className={`chess-wallet-ready-state ${readyStateClass(wallet.readyState)}`}>
                    {readyStateLabel(wallet.readyState)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function ChessWalletModalProvider({ children }: ChessWalletModalProviderProps) {
  const [visible, setVisible] = useState(false);
  const closeModal = useCallback(() => setVisible(false), []);
  const contextValue = useMemo(() => ({ visible, setVisible }), [visible]);

  return (
    <WalletModalContext.Provider value={contextValue}>
      {children}
      {visible && <ChessWalletModal onClose={closeModal} />}
    </WalletModalContext.Provider>
  );
}
