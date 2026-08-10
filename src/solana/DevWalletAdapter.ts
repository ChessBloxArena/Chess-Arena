import {
  BaseWalletAdapter,
  WalletName,
  WalletNotConnectedError,
  WalletReadyState,
  WalletSendTransactionError,
} from "@solana/wallet-adapter-base";
import type { Connection, TransactionSignature } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import type { TransactionOrVersionedTransaction } from "@solana/wallet-adapter-base";

const DEV_WALLET_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%23101612'/%3E%3Cpath d='M12 18h40v28H12z' fill='%2322c55e'/%3E%3Cpath d='M18 24h28v6H18zm0 12h18v6H18z' fill='%23060907'/%3E%3C/svg%3E";

export class DevWalletAdapter extends BaseWalletAdapter<"Dev Wallet"> {
  name = "Dev Wallet" as WalletName<"Dev Wallet">;
  url = "http://127.0.0.1";
  icon = DEV_WALLET_ICON;
  readyState = WalletReadyState.Loadable;
  publicKey: PublicKey | null = null;
  connecting = false;
  supportedTransactionVersions = null;

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    this.connecting = true;
    try {
      this.publicKey = new PublicKey("11111111111111111111111111111111");
      this.emit("connect", this.publicKey);
    } finally {
      this.connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this.publicKey = null;
    this.emit("disconnect");
  }

  async sendTransaction(
    _transaction: TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>,
    _connection: Connection,
  ): Promise<TransactionSignature> {
    if (!this.connected) throw new WalletNotConnectedError();
    throw new WalletSendTransactionError("Dev Wallet is display-only and cannot sign wagers");
  }
}
