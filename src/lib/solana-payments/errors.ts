export type PaymentErrorCode =
  | "INVALID_CONFIG"
  | "INVALID_AMOUNT"
  | "MINT_UNKNOWN"
  | "MINT_DISABLED"
  | "STAKE_TOO_LARGE"
  | "TRANSACTION_UNSUPPORTED"
  | "BALANCE_UNAVAILABLE";

export class PaymentSdkError extends Error {
  readonly code: PaymentErrorCode;

  constructor(code: PaymentErrorCode, message: string) {
    super(message);
    this.name = "PaymentSdkError";
    this.code = code;
  }
}

export function isPaymentSdkError(error: unknown): error is PaymentSdkError {
  return error instanceof PaymentSdkError;
}
