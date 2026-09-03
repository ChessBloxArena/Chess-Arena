const WSOL_MINT = "So11111111111111111111111111111111111111112";
const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const DEFAULT_MAX_STAKE_LAMPORTS = 340_000_000n;

export interface ServerWagerConfig {
  newWagersEnabled: boolean;
  realEscrowEnabled: boolean;
  cluster: string;
  escrowProgramId: string | null;
  assetMint: string;
  assetSymbol: string;
  assetDecimals: number;
  tokenProgramId: string;
  maxStakeLamports: bigint;
  creationEnabled: boolean;
  issues: string[];
}

function booleanEnv(name: string): boolean {
  return Deno.env.get(name) === "true";
}

function optionalEnv(name: string): string | null {
  const value = Deno.env.get(name)?.trim();
  return value ? value : null;
}

function integerEnv(name: string, fallback: number, issues: string[]): number {
  const value = optionalEnv(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 9) return parsed;
  issues.push(`Invalid ${name}`);
  return fallback;
}

function lamportsEnv(name: string, fallback: bigint, issues: string[]): bigint {
  const value = optionalEnv(name);
  if (!value) return fallback;
  try {
    const parsed = BigInt(value);
    if (parsed > 0n && parsed <= 1_000_000_000n) return parsed;
  } catch {
    // Report below.
  }
  issues.push(`Invalid ${name}`);
  return fallback;
}

export function getServerWagerConfig(): ServerWagerConfig {
  const issues: string[] = [];
  const cluster = optionalEnv("WAGER_SOLANA_CLUSTER") ?? "devnet";
  const escrowProgramId = optionalEnv("WAGER_ESCROW_PROGRAM_ID");
  if (!escrowProgramId) issues.push("Missing WAGER_ESCROW_PROGRAM_ID");

  const assetMint = optionalEnv("WAGER_ASSET_MINT") ?? WSOL_MINT;
  const assetSymbol = optionalEnv("WAGER_ASSET_SYMBOL") ?? "SOL";
  const assetDecimals = integerEnv("WAGER_ASSET_DECIMALS", 9, issues);
  const tokenProgramId = optionalEnv("WAGER_TOKEN_PROGRAM_ID") ?? SPL_TOKEN_PROGRAM_ID;
  const maxStakeLamports = lamportsEnv("WAGER_MAX_STAKE_LAMPORTS", DEFAULT_MAX_STAKE_LAMPORTS, issues);
  const newWagersEnabled = booleanEnv("WAGER_NEW_WAGERS_ENABLED");
  const realEscrowEnabled = booleanEnv("WAGER_REAL_ESCROW_ENABLED");
  const creationEnabled =
    issues.length === 0 &&
    cluster === "mainnet-beta" &&
    Boolean(escrowProgramId) &&
    newWagersEnabled &&
    realEscrowEnabled;

  return {
    newWagersEnabled,
    realEscrowEnabled,
    cluster,
    escrowProgramId,
    assetMint,
    assetSymbol,
    assetDecimals,
    tokenProgramId,
    maxStakeLamports,
    creationEnabled,
    issues,
  };
}
