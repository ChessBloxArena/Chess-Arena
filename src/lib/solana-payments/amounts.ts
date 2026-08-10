import { PaymentSdkError } from "./errors.js";

const MAX_DECIMALS = 18;

export function parseTokenAmount(uiAmount: string, decimals: number): bigint {
  assertDecimals(decimals);

  const trimmed = uiAmount.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    throw new PaymentSdkError("INVALID_AMOUNT", "Token amount must be a positive decimal string.");
  }

  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new PaymentSdkError(
      "INVALID_AMOUNT",
      `Token amount has more than ${decimals} decimal places.`
    );
  }

  const paddedFraction = fraction.padEnd(decimals, "0");
  return BigInt(`${whole}${paddedFraction}`.replace(/^0+(?=\d)/, ""));
}

export function formatTokenAmount(
  rawAmount: bigint,
  decimals: number,
  options: { trimTrailingZeros?: boolean } = {}
): string {
  assertDecimals(decimals);

  if (rawAmount < 0n) {
    throw new PaymentSdkError("INVALID_AMOUNT", "Token amount cannot be negative.");
  }

  const divisor = 10n ** BigInt(decimals);
  const whole = rawAmount / divisor;
  const fraction = rawAmount % divisor;

  if (decimals === 0) {
    return whole.toString();
  }

  const fractionText = fraction.toString().padStart(decimals, "0");
  const normalizedFraction = options.trimTrailingZeros
    ? fractionText.replace(/0+$/, "")
    : fractionText;

  return normalizedFraction.length > 0
    ? `${whole.toString()}.${normalizedFraction}`
    : whole.toString();
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new PaymentSdkError(
      "INVALID_AMOUNT",
      `Token decimals must be an integer between 0 and ${MAX_DECIMALS}.`
    );
  }
}
