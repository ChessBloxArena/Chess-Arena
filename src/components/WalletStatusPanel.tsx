import { useState } from "react";
import { RefreshCw, Unplug, Wallet } from "lucide-react";
import type { RobinhoodWallet } from "@/hooks/useRobinhoodWallet";
import { getWagerConfig } from "@/lib/wagerConfig";
import { automaticRblxPayoutEnabled, rblxConversionEnabled, robinhoodEscrowAddress } from "@/lib/robinhoodChain";

export default function WalletStatusPanel({ wallet }: { wallet: RobinhoodWallet }) {
  const [refreshing, setRefreshing] = useState(false);
  const config = getWagerConfig();
  const escrowConfigured = Boolean(robinhoodEscrowAddress());
  const wagersEnabled = config.newWagersEnabled && config.realEscrowEnabled && escrowConfigured;

  const refreshBalance = async () => {
    setRefreshing(true);
    try {
      await wallet.refreshBalance();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="retro-panel p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[9px] font-retro text-muted-foreground">ROBINHOOD WALLET</p>
        <span className={`text-[7px] font-retro ${wallet.address ? "text-primary" : "text-muted-foreground"}`}>
          {wallet.address ? wallet.shortAddress : "NO WALLET"}
        </span>
      </div>

      {wallet.address ? (
        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          <div className="min-w-0">
            <p className="text-[7px] font-retro text-muted-foreground">NATIVE BALANCE</p>
            <p className="mt-1 truncate text-[10px] font-retro text-foreground">
              {wallet.refreshing || refreshing ? "LOADING..." : `${wallet.balanceEth?.toFixed(4) ?? "--"} ETH`}
            </p>
          </div>
          <button className="retro-icon-btn" type="button" onClick={() => void refreshBalance()} disabled={wallet.refreshing || refreshing} aria-label="Refresh ETH balance">
            <RefreshCw className={wallet.refreshing || refreshing ? "animate-spin" : ""} size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <p className="text-[8px] leading-5 text-muted-foreground">
          CONNECT AN EVM WALLET FOR ROBINHOOD CHAIN WAGERS. PRACTICE PLAY NEEDS NO WALLET.
        </p>
      )}

      <div className="wallet-status-grid">
        <span>CHAIN</span><strong>ROBINHOOD (4663)</strong>
        <span>WAGER</span><strong>NATIVE ETH</strong>
        <span>PRIZE</span><strong>{automaticRblxPayoutEnabled() ? "AUTOMATIC RBLX" : rblxConversionEnabled() ? "ETH → OPTIONAL RBLX" : "FULL ETH POT"}</strong>
        <span>ESCROW</span><strong>{escrowConfigured ? "CONFIGURED" : "MISSING"}</strong>
        <span>WAGERS</span><strong className={wagersEnabled ? "text-primary" : "text-accent"}>{wagersEnabled ? "ENABLED" : "DISABLED"}</strong>
      </div>

      {wallet.error && <p className="text-[7px] leading-4 text-destructive">WALLET ERROR: {wallet.error}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        {!wallet.address ? (
          <button className="retro-btn retro-btn-small flex flex-1 items-center justify-center gap-2" onClick={() => void wallet.connect()}>
            <Wallet size={14} aria-hidden="true" />
            {wallet.connecting ? "CONNECTING..." : "CONNECT EVM WALLET"}
          </button>
        ) : (
          <button className="retro-btn retro-btn-small flex flex-1 items-center justify-center gap-2" onClick={() => void wallet.disconnect()}>
            <Unplug size={14} aria-hidden="true" /> DISCONNECT
          </button>
        )}
      </div>
      <a href="/funds" className="block text-center text-sm font-bold underline">MY FUNDS & MATCHES</a>
    </div>
  );
}
