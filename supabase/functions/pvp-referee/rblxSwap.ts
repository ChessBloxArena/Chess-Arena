import { getAddress, isAddress, type Hex } from "viem";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_NATIVE_ETH, ROBINHOOD_RBLX, ROBINHOOD_UNIVERSAL_ROUTER } from "./robinhoodChain.ts";

// Robinhood's deployed router is 2.1.1. Requesting 2.2.0 returns no routes.
export const RBLX_ROUTER_VERSION = "2.1.1";

export class RblxQuoteError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const positiveAmount = (value: unknown): value is string => typeof value === "string" && /^[0-9]+$/.test(value) && BigInt(value) > 0n;

export async function buildRblxSwapQuote(input: {
  apiKey: string;
  walletAddress: string;
  swapperAddress?: string;
  payoutWei: bigint;
  slippageBps?: number;
  fetchImpl?: typeof fetch;
}) {
  const { apiKey, payoutWei } = input;
  if (!isAddress(input.walletAddress) || payoutWei <= 0n) throw new RblxQuoteError(400, "Invalid swap account or prize.");
  const walletAddress = getAddress(input.walletAddress);
  const swapperAddress = getAddress(input.swapperAddress ?? input.walletAddress);
  const slippageBps = Number.isFinite(input.slippageBps) ? Math.min(500, Math.max(1, Math.round(input.slippageBps!))) : 100;
  const headers = {
    "content-type": "application/json", "accept": "application/json",
    "x-api-key": apiKey, "x-universal-router-version": RBLX_ROUTER_VERSION,
  };
  const request = input.fetchImpl ?? fetch;
  const permissionsResponse = await request("https://trade-api.gateway.uniswap.org/v1/permissions", {
    method: "POST", headers,
    body: JSON.stringify({ walletAddress, tokens: [ROBINHOOD_RBLX], chainId: ROBINHOOD_CHAIN_ID }),
    signal: AbortSignal.timeout(15_000),
  });
  const permissionBody = await permissionsResponse.json().catch(() => null) as {
    results?: Array<{ token?: string; isPermissioned?: boolean; isAllowlisted?: boolean; kycUrl?: string }>;
  } | null;
  if (!permissionsResponse.ok) throw new RblxQuoteError(502, "RBLX eligibility could not be verified. Your ETH stays in your wallet.");
  const permission = permissionBody?.results?.[0];
  if (!permission || permission.token?.toLowerCase() !== ROBINHOOD_RBLX.toLowerCase() || typeof permission.isPermissioned !== "boolean") {
    throw new RblxQuoteError(502, "Uniswap returned an invalid RBLX eligibility result.");
  }
  if (permission.isPermissioned && permission.isAllowlisted !== true) throw new RblxQuoteError(403, "This wallet is not eligible to receive RBLX. Complete Robinhood Stock Token eligibility before trying again.");

  const quoteResponse = await request("https://trade-api.gateway.uniswap.org/v1/quote", {
    method: "POST", headers,
    body: JSON.stringify({
      type: "EXACT_INPUT", amount: payoutWei.toString(), tokenInChainId: ROBINHOOD_CHAIN_ID,
      tokenOutChainId: ROBINHOOD_CHAIN_ID, tokenIn: ROBINHOOD_NATIVE_ETH, tokenOut: ROBINHOOD_RBLX,
      swapper: swapperAddress, recipient: walletAddress, routingPreference: "BEST_PRICE",
      protocols: ["V4"], slippageTolerance: slippageBps / 100,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const quoteBody = await quoteResponse.json().catch(() => null) as {
    routing?: string;
    quote?: { chainId?: number; swapper?: string; output?: { amount?: string; minimumAmount?: string; token?: string; recipient?: string }; input?: { amount?: string; token?: string } };
  } | null;
  if (!quoteResponse.ok || !quoteBody?.quote) throw new RblxQuoteError(502, "Uniswap cannot quote this ETH-to-RBLX swap right now. Keep your ETH or try again later.");
  if (quoteBody.routing !== "CLASSIC") throw new RblxQuoteError(502, "Uniswap returned an unsupported route type.");
  const quote = quoteBody.quote;
  const quotedOut = quote.output?.amount;
  const minimumOut = quote.output?.minimumAmount;
  if (!positiveAmount(quotedOut) || !positiveAmount(minimumOut) || BigInt(minimumOut) > BigInt(quotedOut) || quote.input?.amount !== payoutWei.toString()) {
    throw new RblxQuoteError(502, "Uniswap quote amounts are invalid.");
  }
  if (quote.chainId !== ROBINHOOD_CHAIN_ID || quote.swapper?.toLowerCase() !== swapperAddress.toLowerCase()
    || quote.output?.token?.toLowerCase() !== ROBINHOOD_RBLX.toLowerCase()
    || quote.output?.recipient?.toLowerCase() !== walletAddress.toLowerCase()
    || quote.input?.token?.toLowerCase() !== ROBINHOOD_NATIVE_ETH) {
    throw new RblxQuoteError(502, "Uniswap quote assets, account or network are invalid.");
  }

  const swapResponse = await request("https://trade-api.gateway.uniswap.org/v1/swap", {
    method: "POST", headers,
    body: JSON.stringify({ quote, simulateTransaction: false }),
    signal: AbortSignal.timeout(20_000),
  });
  const swapBody = await swapResponse.json().catch(() => null) as {
    gasFee?: string;
    swap?: { to?: string; from?: string; data?: string; value?: string; chainId?: number };
  } | null;
  if (!swapResponse.ok || !swapBody?.swap) throw new RblxQuoteError(502, "Uniswap could not prepare the RBLX swap. Your ETH stays in your wallet.");
  const swap = swapBody.swap;
  if (!isAddress(swap.to || "") || swap.to?.toLowerCase() !== ROBINHOOD_UNIVERSAL_ROUTER.toLowerCase()) throw new RblxQuoteError(502, "Uniswap returned the wrong router.");
  if (!isAddress(swap.from || "") || swap.from?.toLowerCase() !== swapperAddress.toLowerCase()) throw new RblxQuoteError(502, "Uniswap returned the wrong swapper.");
  // Uniswap returns native transaction values as hex; preserve exact integer value.
  if (typeof swap.value !== "string" || !/^(?:[0-9]+|0x[0-9a-fA-F]+)$/.test(swap.value)
    || BigInt(swap.value) !== payoutWei || swap.chainId !== ROBINHOOD_CHAIN_ID
    || !/^0x(?:[0-9a-fA-F]{2}){4,}$/.test(swap.data || "")) {
    throw new RblxQuoteError(502, "Uniswap returned invalid transaction parameters.");
  }
  return {
    transaction: { to: getAddress(swap.to!), data: swap.data as Hex, value: payoutWei.toString(), chainId: ROBINHOOD_CHAIN_ID },
    walletAddress,
    minimumRblxOut: minimumOut,
    quotedRblxOut: quotedOut,
    estimatedGasWei: positiveAmount(swapBody.gasFee) ? swapBody.gasFee : undefined,
    slippageBps,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
  };
}
