/** Keep escrow enforceable through both clocks, every allowed increment and settlement. */
export function requiredEscrowLifetimeSeconds(clockMs: number, incrementMs: number, maxPlies: number): number {
  if (![clockMs, incrementMs, maxPlies].every(Number.isSafeInteger) || clockMs <= 0 || incrementMs < 0 || maxPlies <= 0) {
    throw new Error("Invalid match lifetime configuration");
  }
  const duration = Math.ceil((2 * clockMs + maxPlies * incrementMs) / 1000) + 600;
  if (!Number.isSafeInteger(duration) || duration > 2_592_000) throw new Error("Match exceeds supported escrow lifetime");
  return duration;
}

export function assertEscrowLifetime(expiresAt: bigint, nowSeconds: number, requiredSeconds: number): void {
  if (!Number.isSafeInteger(nowSeconds) || !Number.isSafeInteger(requiredSeconds) || requiredSeconds <= 0) {
    throw new Error("Invalid match lifetime configuration");
  }
  if (expiresAt < BigInt(nowSeconds + requiredSeconds)) {
    throw new Error("Escrow expires too soon for this match. The host must refund and create a new lobby.");
  }
}
