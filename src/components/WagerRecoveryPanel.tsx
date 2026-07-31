import { useState } from "react";
import { RefreshCcw, RotateCcw, Wallet } from "lucide-react";
import { buildUnwrapSolTransaction } from "@/lib/solanaWagerTransactions";
import {
  listRecoverableWagers,
  recoverOrphanedWagerRefund,
  resolveBrowserEscrowFactory,
  type RecoverableWager,
} from "@/lib/wagerRefereeClient";
import { formatRawAmount, getWagerConfig } from "@/lib/wagerConfig";
import type { SolanaWalletState } from "@/hooks/useSolanaWallet";

interface WagerRecoveryPanelProps {
  wallet: SolanaWalletState;
}

type BusyAction = "scan" | "refund" | "unwrap" | null;

function short(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export default function WagerRecoveryPanel({ wallet }: WagerRecoveryPanelProps) {
  const wagerConfig = getWagerConfig();
  const [recoverable, setRecoverable] = useState<RecoverableWager[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refundSignature, setRefundSignature] = useState<string | null>(null);
  const [unwrapSignature, setUnwrapSignature] = useState<string | null>(null);

  const scan = async () => {
    const owner = wallet.publicKey ?? await wallet.connect();
    if (!owner || !wallet.address) throw new Error("Connect the wager wallet first.");
    if (!wallet.signMessage) throw new Error("Wallet message signing is required for recovery.");
    const rows = await listRecoverableWagers({
      walletAddress: wallet.address,
      signMessage: wallet.signMessage,
    });
    setRecoverable(rows);
    setHasScanned(true);
  };

  const refund = async (row: RecoverableWager) => {
    const owner = wallet.publicKey ?? await wallet.connect();
    if (!owner || !wallet.address) throw new Error("Connect the wager wallet first.");
    if (!wallet.signMessage) throw new Error("Wallet message signing is required for recovery.");
    const escrow = resolveBrowserEscrowFactory();
    if (!escrow) throw new Error("Escrow SDK is unavailable.");
    const response = await recoverOrphanedWagerRefund({
      gameId: row.gameId,
      walletPublicKey: owner,
      walletAddress: wallet.address,
      whiteWalletAddress: row.whiteWalletAddress,
      blackWalletAddress: row.blackWalletAddress,
      assetMint: row.assetMint,
      tokenProgramId: wagerConfig.asset.tokenProgramId,
      stakeLamports: BigInt(row.stakeLamports),
      escrowContestId: row.contestId,
      escrow,
      signAndSendTransaction: wallet.signAndSendTransaction,
      signMessage: wallet.signMessage,
    });
    if (response.refundSignature) setRefundSignature(response.refundSignature);
    await wallet.refreshBalance(owner);
    await scan();
  };

  const unwrapSol = async () => {
    const owner = wallet.publicKey ?? await wallet.connect();
    if (!owner) throw new Error("Connect the wager wallet first.");
    const request = buildUnwrapSolTransaction(owner);
    const signature = await wallet.signAndSendTransaction(request.transaction);
    setUnwrapSignature(signature);
    await wallet.refreshBalance(owner);
  };

  const run = async (action: BusyAction, fn: () => Promise<void>) => {
    setBusyAction(action);
    setActionError(null);
    try {
      await fn();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Recovery action failed");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="border border-primary/30 bg-background/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[7px] font-retro text-primary">STUCK WAGER RECOVERY</p>
        <button
          className="retro-btn retro-btn-small"
          disabled={busyAction !== null}
          onClick={() => run("scan", scan)}
        >
          <RefreshCcw size={12} /> {busyAction === "scan" ? "SCANNING" : "SCAN"}
        </button>
      </div>

      {hasScanned && recoverable.length === 0 && (
        <p className="text-[6px] font-retro text-muted-foreground text-center">
          NO FUNDED STUCK ESCROWS FOUND
        </p>
      )}

      {recoverable.map((row) => (
        <div key={row.gameId} className="border border-border/50 p-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[6px] font-retro text-foreground">
              {formatRawAmount(BigInt(row.vaultAmount), Number(row.assetDecimals ?? 9))} {row.assetSymbol ?? "SOL"}
            </p>
            <p className="text-[6px] font-retro text-muted-foreground">{short(row.contestId)}</p>
          </div>
          <button
            className="retro-btn retro-btn-small w-full"
            disabled={busyAction !== null || !row.canRefund}
            onClick={() => run("refund", () => refund(row))}
          >
            <RotateCcw size={12} /> {busyAction === "refund" ? "REFUNDING" : row.canRefund ? "REFUND ESCROW" : "WAITING FOR EXPIRY"}
          </button>
        </div>
      ))}

      {(refundSignature || unwrapSignature) && (
        <div className="space-y-2">
          {refundSignature && (
            <p className="text-[6px] font-retro text-primary">REFUND TX: {short(refundSignature)}</p>
          )}
          {unwrapSignature && (
            <p className="text-[6px] font-retro text-primary">UNWRAP TX: {short(unwrapSignature)}</p>
          )}
          <button
            className="retro-btn retro-btn-small w-full"
            disabled={busyAction !== null}
            onClick={() => run("unwrap", unwrapSol)}
          >
            <Wallet size={12} /> {busyAction === "unwrap" ? "SIGNING" : "UNWRAP SOL"}
          </button>
        </div>
      )}

      {(actionError || wallet.error) && (
        <p className="text-[6px] font-retro text-destructive text-center">{actionError || wallet.error}</p>
      )}
    </div>
  );
}
