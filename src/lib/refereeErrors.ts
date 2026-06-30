export type RefereeErrorCode =
  | 'captcha_required'
  | 'captcha_failed'
  | 'wallet_proof_required'
  | 'wallet_proof_failed'
  | string;

export class RefereeClientError extends Error {
  code?: RefereeErrorCode;

  constructor(message: string, code?: RefereeErrorCode) {
    super(message);
    this.name = 'RefereeClientError';
    this.code = code;
  }
}
