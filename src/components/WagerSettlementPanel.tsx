import { translateText, localize, useLanguage, getLanguage } from '@/lib/i18n';
import { useEffect, useRef, useState } from "react";
import { Coins, RefreshCcw, Wallet } from "lucide-react";
import WagerTransactionLinks from "@/components/WagerTransactionLinks";
import type { WagerSettlementSummary } from "@/lib/wagerSettlement";
import { rblxConversionEnabled, robinhoodTransactionUrl } from "@/lib/robinhoodChain";
import { formatEther, formatUnits, type Hash } from "viem";
import type { RblxSwapQuote } from "@/lib/robinhoodWagerClient";

interface WagerSettlementPanelProps {
  summary: WagerSettlementSummary;
  onRefund: () => Promise<void>;
  onClaimEth: () => Promise<string>;
  onPrepareRblxSwap: (claimTransactionHash: Hash) => Promise<RblxSwapQuote>;
  onConvertToRblx: (claimTransactionHash: Hash, quote: RblxSwapQuote) => Promise<string>;
  playerColor: "w" | "b" | null;
}

export function wagerSettlementStatusCopy(summary: WagerSettlementSummary, playerColor: "w" | "b" | null): string {
  const didWin = !!playerColor && summary.winner === playerColor;
  const didLose = !!playerColor && (summary.winner === "w" || summary.winner === "b") && summary.winner !== playerColor;
  const isDraw = summary.winner === "draw";
  if (summary.payoutMode === "automatic_rblx" && !isDraw && summary.state === "settled") {
    if (summary.automaticPayoutStatus === "paid_rblx") return "RBLX PAID";
    if (summary.automaticPayoutStatus === "paid_eth") return "ETH PAID";
    return "AUTOMATIC PAYOUT PENDING";
  }
  if (summary.paymentMode === "robinhood_eth_escrow" && summary.state === "settled") {
    if (didWin || isDraw) return "PRIZE READY";
    if (didLose) return "ESCROW SETTLED";
  }
  switch (summary.state) {
    case "settled": return isDraw ? "REFUNDED" : didWin ? "PAID" : didLose ? "ESCROW SETTLED" : "SETTLED";
    case "cancelled": return "CANCELLED";
    case "refund_pending": return "REFUND PENDING";
    case "refunded": return "REFUNDED";
    case "retryable_failure": return "SETTLEMENT RETRYING";
    case "support_needed": return "SUPPORT NEEDED";
    case "failed": return "SETTLEMENT FAILED";
    case "pending": return "SETTLEMENT PENDING";
    default: return "NO WAGER";
  }
}

export function wagerSettlementPayoutCopy(summary: WagerSettlementSummary, playerColor: "w" | "b" | null): string {
  const didWin = !!playerColor && summary.winner === playerColor;
  const didLose = !!playerColor && (summary.winner === "w" || summary.winner === "b") && summary.winner !== playerColor;
  const sponsored = summary.paymentMode === "native_sol_sponsored";
  const robinhood = summary.paymentMode === "robinhood_eth_escrow";
  if (robinhood && summary.state === "refunded") return `Refund ready: claim your ${summary.stakeLabel}.`;
  if (summary.state === "retryable_failure") return "Settlement retrying. The worker will keep checking the escrow result.";
  if (summary.state === "support_needed") return "Support needed. Settlement could not be reconciled automatically yet.";
  if (summary.state === "refunded") return sponsored ? "Your stake was refunded automatically." : "Your wager refund was sent.";
  if (summary.winner === "draw") {
    return robinhood && summary.state === "settled"
      ? `Draw ready: claim your ${summary.stakeLabel}.`
      : summary.state === "settled" ? `Draw settled: ${summary.stakeLabel} returned to each player.` : `Draw: ${summary.stakeLabel} returns to each player.`;
  }
  if (summary.payoutMode === "automatic_rblx" && summary.winner !== "draw") {
    if (summary.automaticPayoutStatus === "paid_rblx") return `${formatUnits(BigInt(summary.automaticPayoutAmount || "0"), 18)} RBLX sent directly to ${didWin ? "your" : "the winner’s"} wallet.`;
    if (summary.automaticPayoutStatus === "paid_eth") return `The swap could not complete within the payout window. The full ETH prize was sent to ${didWin ? "your" : "the winner’s"} wallet.`;
    return `The prize converts to RBLX automatically after settlement. ChessBlox pays the payout network fee. If conversion cannot meet the authorized minimum within 15 minutes, the full ETH prize is paid instead.`;
  }
  if (didWin) {
    if (robinhood && summary.state === "settled") return rblxConversionEnabled()
      ? `${summary.payoutLabel} is ready. Claim ETH first, then optionally convert it to RBLX.`
      : `${summary.payoutLabel} is ready to claim to your wallet.`;
    return summary.state === "settled" ? `${summary.payoutLabel} paid to your wallet.` : `${summary.payoutLabel} will settle automatically.`;
  }
  if (didLose) return robinhood ? "You lost. The winner can now claim the escrowed pot." : sponsored ? "You lost. The sponsored wager pays the winner automatically." : "You lost. The escrow pays the winner.";
  return summary.payoutLabel;
}

export default function WagerSettlementPanel({ summary, onRefund, onClaimEth, onPrepareRblxSwap, onConvertToRblx, playerColor }: WagerSettlementPanelProps) {
  useLanguage();
  const [busyAction, setBusyAction] = useState<"refund" | "claim" | "quote" | "swap" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [claimHash, setClaimHash] = useState<Hash | null>(null);
  const [swapHash, setSwapHash] = useState<Hash | null>(null);
  const [eligibleForRblx, setEligibleForRblx] = useState(false);
  const [uniswapTermsAccepted, setUniswapTermsAccepted] = useState(false);
  const [quote, setQuote] = useState<RblxSwapQuote | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!quote && summary.payoutMode !== "automatic_rblx") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quote, summary.payoutMode]);
  const actionInFlight = useRef(false);
  const receiptKey = `chessblox:receipts:${summary.paymentMode}:${summary.contestId}:${playerColor}`;
  useEffect(() => {
    setClaimHash(null);
    setSwapHash(null);
    setEligibleForRblx(false);
    setUniswapTermsAccepted(false);
    setQuote(null);
    try {
      const saved = JSON.parse(window.localStorage.getItem(receiptKey) || "{}");
      if (/^0x[0-9a-fA-F]{64}$/.test(saved.claim || "")) setClaimHash(saved.claim);
      if (/^0x[0-9a-fA-F]{64}$/.test(saved.swap || "")) setSwapHash(saved.swap);
    } catch { /* Receipt storage is optional; the backend verifies every conversion claim. */ }
  }, [receiptKey]);

  const runAction = async (action: "refund" | "claim" | "quote" | "swap", fn: () => Promise<string | void>) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusyAction(action);
    setActionError(null);
    try {
      const hash = await fn();
      if (typeof hash === "string") {
        if (action === "swap") setSwapHash(hash as Hash);
        else setClaimHash(hash as Hash);
        try {
          const saved = JSON.parse(window.localStorage.getItem(receiptKey) || "{}");
          window.localStorage.setItem(receiptKey, JSON.stringify({ ...saved, [action === "swap" ? "swap" : "claim"]: hash }));
        } catch { /* A storage failure must not turn a successful transaction into a failure. */ }
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      actionInFlight.current = false;
      setBusyAction(null);
    }
  };

  if (!summary.isWagered) return null;
  const didWin = !!playerColor && summary.winner === playerColor;
  const isDraw = summary.winner === "draw";
  const robinhood = summary.paymentMode === "robinhood_eth_escrow";
  const canClaimRefund = robinhood && summary.state === "refunded";
  const automatic = summary.payoutMode === "automatic_rblx";
  const automaticallyPaid = summary.automaticPayoutStatus === "paid_rblx" || summary.automaticPayoutStatus === "paid_eth";
  const fallbackReady = automatic && !!summary.ethFallbackAt && Date.parse(summary.ethFallbackAt) <= now && !automaticallyPaid;
  const hasClaimReceipt = !!claimHash && (!automatic || isDraw || canClaimRefund || fallbackReady);
  const canClaim = (!automatic || isDraw || canClaimRefund || fallbackReady) && robinhood && ((summary.state === "settled" && (didWin || isDraw)) || canClaimRefund) && !claimHash;
  const canConvertToRblx = !automatic && rblxConversionEnabled() && robinhood && summary.state === "settled" && didWin && !isDraw && !!claimHash && !swapHash;
  const canRefund = summary.refundAvailable && summary.state !== "settled";
  const quoteExpired = !!quote && Date.parse(quote.expiresAt) <= now;
  const canRequestQuote = busyAction === null && eligibleForRblx && uniswapTermsAccepted;

  return (
    <div className="settlement-panel">
      <div className="settlement-summary" data-claimed={hasClaimReceipt}>
        <div className="settlement-summary-heading">
          <p className="settlement-status" role="status">{localize(hasClaimReceipt ? "Funds claimed" : wagerSettlementStatusCopy(summary, playerColor))}</p>
          <p className="settlement-stake"><span>{translateText("Your stake")}</span><strong>{localize(summary.stakeLabel)}</strong></p>
        </div>
        <p className="settlement-payout">{localize(hasClaimReceipt ? "Your ETH claim is confirmed. View the receipt below." : wagerSettlementPayoutCopy(summary, playerColor))}</p>
        <p className="settlement-result">{translateText("RESULT: ")}{localize(summary.resultType.toUpperCase())}</p>

      </div>

      <details className="settlement-details">
        <summary>{translateText("Transaction details")}</summary>
        <WagerTransactionLinks links={summary.transactionLinks} />
        {summary.contestId && <p className="settlement-contest">{translateText("CONTEST: ")}<code>{summary.contestId}</code></p>}
      </details>
      {localize(summary.automaticPayoutSignature && <a className="block text-sm underline text-primary" target="_blank" rel="noreferrer" href={robinhoodTransactionUrl(summary.automaticPayoutSignature)}>{translateText("View automatic payout transaction ↗")}</a>)}
      {localize(automatic && didWin && !automaticallyPaid && summary.ethFallbackAt && <p className="text-sm text-muted-foreground">{translateText("ETH recovery available after ")}{localize(new Date(summary.ethFallbackAt).toLocaleTimeString(getLanguage()))}{translateText(". Open My funds to check the latest on-chain status.")}</p>)}
      {localize(claimHash && (
        <a className="settlement-receipt" href={robinhoodTransactionUrl(claimHash)} target="_blank" rel="noreferrer">{translateText("ETH CLAIM TX: ")}{localize(claimHash.slice(0, 12))}…
        </a>
      ))}
      {localize(swapHash && (
        <a className="settlement-receipt" href={robinhoodTransactionUrl(swapHash)} target="_blank" rel="noreferrer">{translateText("RBLX SWAP TX: ")}{localize(swapHash.slice(0, 12))}…
        </a>
      ))}

      {localize(canConvertToRblx && (
        <section aria-label={translateText("Convert winnings to RBLX")} className="space-y-4 rounded-xl border border-primary/30 bg-card p-4 text-sm leading-5">
          <div><h3 className="font-bold text-base">{translateText("Keep your ETH or swap to RBLX")}</h3><p className="mt-1 text-muted-foreground">{translateText("RBLX is a Robinhood token linked to Roblox stock. It is a tokenized debt security, not Robux or a share of Roblox.")}</p></div>
          <label className="flex items-start gap-3"><input className="mt-1" type="checkbox" checked={eligibleForRblx} onChange={(event) => { setEligibleForRblx(event.target.checked); setQuote(null); }} /><span>{translateText("I confirm I am eligible to receive Robinhood Stock Tokens in my jurisdiction.")}</span></label>
          <label className="flex items-start gap-3"><input className="mt-1" type="checkbox" checked={uniswapTermsAccepted} onChange={(event) => { setUniswapTermsAccepted(event.target.checked); setQuote(null); }} /><span>{translateText("I agree to the ")}<a className="underline text-primary" target="_blank" rel="noreferrer" href="https://support.uniswap.org/hc/en-us/articles/30935100859661">{translateText("Uniswap Terms of Service")}</a>{translateText(" and ")}<a className="underline text-primary" target="_blank" rel="noreferrer" href="https://support.uniswap.org/hc/en-us/articles/30934457771405">{translateText("Privacy Policy")}</a>.</span></label>
          <button className="retro-btn retro-btn-small" disabled={!canRequestQuote} onClick={() => void runAction("quote", async () => { setQuote(null); setQuote(await onPrepareRblxSwap(claimHash!)); })}>{localize(busyAction === "quote" ? "Getting quote…" : quote ? "Refresh RBLX quote" : "Get RBLX quote")}</button>
          {localize(quote && <div aria-label={translateText("Swap quote")} className="space-y-3 border-t border-border pt-4">
            <dl className="space-y-2">
              <div className="flex justify-between gap-3"><dt>{translateText("You pay")}</dt><dd className="font-bold">{localize(formatEther(BigInt(quote.transaction.value)))}{translateText(" ETH")}</dd></div>
              <div className="flex justify-between gap-3"><dt>{translateText("Estimated receive")}</dt><dd className="break-all text-right font-bold">{localize(formatUnits(BigInt(quote.quotedRblxOut), 18))}{translateText(" RBLX")}</dd></div>
              <div className="flex justify-between gap-3"><dt>{translateText("Minimum receive")}</dt><dd className="break-all text-right font-bold">{localize(formatUnits(BigInt(quote.minimumRblxOut), 18))}{translateText(" RBLX")}</dd></div>
              <div className="flex justify-between gap-3"><dt>{translateText("Slippage limit")}</dt><dd>{localize(quote.slippageBps / 100)}%</dd></div>
              <div className="flex justify-between gap-3"><dt>{translateText("Estimated network fee")}</dt><dd>{localize(quote.estimatedGasWei ? `${formatEther(BigInt(quote.estimatedGasWei))} ETH` : "Shown in wallet")}</dd></div>
            </dl>
            <p className="break-all text-xs text-muted-foreground">{translateText("Robinhood Chain · Receive in ")}{localize(quote.walletAddress)}</p>
            <p className="text-xs text-muted-foreground">{translateText("The network fee is additional. Your wallet shows the final fee before you approve.")}</p>
            <p role="status" aria-label={translateText("Quote status")}>{localize(quoteExpired ? "Quote expired. Refresh it before swapping." : `Quote expires in ${Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - now) / 1000))} seconds.`)}</p>
            <button className="retro-btn retro-btn-small retro-btn-gold w-full" disabled={!canRequestQuote || quoteExpired} onClick={() => void runAction("swap", () => onConvertToRblx(claimHash!, quote))}><Coins size={14} /> {localize(busyAction === "swap" ? "Confirm in wallet…" : "Confirm ETH → RBLX swap")}</button>
          </div>)}
          <p className="text-xs text-muted-foreground">{translateText("Powered by Uniswap Labs. Requesting a quote does not send a swap. You can keep your ETH at any time.")}</p>
        </section>
      ))}

      {localize(claimHash && !swapHash && didWin && summary.state === "settled" && <p className="settlement-confirmation">{localize(rblxConversionEnabled() ? "ETH CLAIMED. KEEP IT OR CONVERT IT TO RBLX." : "ETH CLAIM CONFIRMED.")}</p>)}
      {localize(swapHash && <p className="settlement-confirmation">{translateText("RBLX SENT TO YOUR WALLET.")}</p>)}

      <div className="settlement-actions">
        {localize(canRefund && <button className="retro-btn retro-btn-small" disabled={busyAction !== null} onClick={() => runAction("refund", onRefund)}><RefreshCcw size={12} /> {localize(busyAction === "refund" ? "REFUNDING" : "REFUND")}</button>)}
        {localize(canClaim && <button className="retro-btn retro-btn-small" disabled={busyAction !== null} onClick={() => runAction("claim", onClaimEth)}><Wallet size={12} /> {localize(busyAction === "claim" ? "CLAIMING" : canClaimRefund ? "CLAIM REFUND" : "CLAIM ETH")}</button>)}
      </div>

      {localize(actionError && <p role="alert" className="break-words text-center text-sm text-destructive">{localize(actionError)}</p>)}
    </div>
  );
}
