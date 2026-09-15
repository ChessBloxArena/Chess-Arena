import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WagerSettlementPanel from "@/components/WagerSettlementPanel";
import type { WagerSettlementSummary } from "@/lib/wagerSettlement";
import type { Hash } from "viem";

const claimHash = `0x${"1".repeat(64)}` as Hash;
const swapHash = `0x${"2".repeat(64)}` as Hash;

const summary: WagerSettlementSummary = {
  isWagered: true,
  paymentMode: "robinhood_eth_escrow",
  state: "settled",
  resultType: "checkmate",
  payoutLabel: "Winner payout: 0.2 ETH",
  stakeLabel: "0.1 ETH",
  assetSymbol: "ETH",
  winner: "w",
  contestId: "contest-a",
  settlementSignature: null,
  refundSignature: null,
  settlementExplorerUrl: null,
  refundExplorerUrl: null,
  transactionLinks: [],
  retryAvailable: false,
  refundAvailable: false,
  unwrapAvailable: false,
};

const quote = {
  gameId: 'game-a', claimTransactionHash: claimHash,
  walletAddress: '0x1111111111111111111111111111111111111111' as const,
  transaction: { to: '0x8876789976decbfcbbbe364623c63652db8c0904' as const, data: '0x12345678' as const, value: '200000000000000000', chainId: 4663 },
  minimumRblxOut: '9900000000000000000', quotedRblxOut: '10000000000000000000',
  estimatedGasWei: '70000000000000', slippageBps: 100, expiresAt: '2030-01-01T00:00:00Z',
};
const props = () => ({ summary, playerColor: 'w' as const, onRefund: vi.fn(), onClaimEth: vi.fn().mockResolvedValue(claimHash), onPrepareRblxSwap: vi.fn().mockResolvedValue(quote), onConvertToRblx: vi.fn().mockResolvedValue(swapHash) });
const restoreClaim = () => window.localStorage.setItem("chessblox:receipts:robinhood_eth_escrow:contest-a:w", JSON.stringify({claim:claimHash}));
const acceptSwapTerms = () => {
  fireEvent.click(screen.getByRole('checkbox', {name:/eligible to receive/}));
  fireEvent.click(screen.getByRole('checkbox', {name:/I agree to/}));
};

describe("WagerSettlementPanel Robinhood prize flow", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_RBLX_CONVERSION_ENABLED", "true");
    const entries = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
      clear: () => entries.clear(),
    } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("claims ETH, obtains consent, and reviews a quote before a separate swap confirmation", async () => {
    const actions = props();
    render(<WagerSettlementPanel {...actions} />);
    expect(screen.queryByRole('button', {name:/Get RBLX quote/})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name:/claim eth/i}));
    const quoteButton = await screen.findByRole('button', {name:/Get RBLX quote/});
    expect(quoteButton).toBeDisabled();
    expect(actions.onPrepareRblxSwap).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', {name:/eligible to receive/}));
    expect(quoteButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', {name:/I agree to/}));
    fireEvent.click(quoteButton);
    const confirm = await screen.findByRole('button', {name:/Confirm ETH → RBLX swap/});
    expect(screen.getByText('10 RBLX')).toBeInTheDocument();
    expect(screen.getByText('9.9 RBLX')).toBeInTheDocument();
    expect(screen.getByText('0.00007 ETH')).toBeInTheDocument();
    expect(actions.onConvertToRblx).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(actions.onConvertToRblx).toHaveBeenCalledWith(claimHash, quote));
    expect(await screen.findByText('RBLX SENT TO YOUR WALLET.')).toBeInTheDocument();
  });

  it("restores a claimed prize after reload without claiming twice", async () => {
    restoreClaim();
    const actions = props();
    render(<WagerSettlementPanel {...actions} />);
    expect(await screen.findByRole('button', {name:/Get RBLX quote/})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name:/claim eth/i})).not.toBeInTheDocument();
    expect(actions.onClaimEth).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Funds claimed');
    expect(screen.queryByText('PRIZE READY')).not.toBeInTheDocument();
    expect(screen.getByText('Your ETH claim is confirmed. View the receipt below.')).toBeInTheDocument();
  });

  it("disables confirmation when a quote has expired", async () => {
    restoreClaim();
    const actions = props();
    actions.onPrepareRblxSwap.mockResolvedValue({...quote, expiresAt:'2020-01-01T00:00:00Z'});
    render(<WagerSettlementPanel {...actions} />);
    acceptSwapTerms();
    fireEvent.click(screen.getByRole('button', {name:/Get RBLX quote/}));
    expect(await screen.findByRole('button', {name:/Confirm ETH → RBLX swap/})).toBeDisabled();
    expect(screen.getByRole('status', { name: 'Quote status' })).toHaveTextContent('Quote expired');
    expect(actions.onConvertToRblx).not.toHaveBeenCalled();
  });

  it("keeps the claimed ETH when Uniswap cannot provide a route", async () => {
    restoreClaim();
    const actions=props();
    actions.onPrepareRblxSwap.mockRejectedValue(new Error('No route available. Your ETH stays in your wallet.'));
    render(<WagerSettlementPanel {...actions} />);
    acceptSwapTerms();
    fireEvent.click(screen.getByRole('button', {name:/Get RBLX quote/}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your ETH stays in your wallet');
    expect(screen.queryByRole('button', {name:/Confirm ETH/})).not.toBeInTheDocument();
    expect(actions.onConvertToRblx).not.toHaveBeenCalled();
  });

  it("hides the optional swap when conversion is disabled", () => {
    vi.stubEnv('VITE_RBLX_CONVERSION_ENABLED','false');
    restoreClaim();
    render(<WagerSettlementPanel {...props()} />);
    expect(screen.queryByRole('button', {name:/RBLX/})).not.toBeInTheDocument();
  });
});


describe('automatic payout status', () => {
  it('does not request another wallet swap after an automatic payout', () => {
    const actions = props();
    render(<WagerSettlementPanel {...actions} summary={{...summary,payoutMode:'automatic_rblx',automaticPayoutStatus:'paid_rblx',automaticPayoutAmount:'3000000000000000000',automaticPayoutSignature:swapHash}} />);
    expect(screen.getByText('RBLX PAID')).toBeInTheDocument();
    expect(screen.getByText(/3 RBLX sent directly/)).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/claim eth/i})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/quote|swap/i})).not.toBeInTheDocument();
  });
  it('keeps the recovery claim hidden during the automatic conversion window', () => {
    render(<WagerSettlementPanel {...props()} summary={{...summary,payoutMode:'automatic_rblx',automaticPayoutStatus:'pending',ethFallbackAt:'2030-01-01T00:00:00Z'}} />);
    expect(screen.getByText('AUTOMATIC PAYOUT PENDING')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/claim eth/i})).not.toBeInTheDocument();
  });
});
