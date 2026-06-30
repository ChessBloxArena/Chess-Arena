/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOLANA_CLUSTER?: string;
  readonly VITE_SOLANA_RPC_URL?: string;
  readonly VITE_LAUNCH_CONTRACT_ADDRESS?: string;
  readonly VITE_LAUNCH_TOKEN_SYMBOL?: string;
  readonly VITE_WAGER_PAYMENT_MODE?: string;
  readonly VITE_WAGER_NEW_WAGERS_ENABLED?: string;
  readonly VITE_WAGER_REAL_ESCROW_ENABLED?: string;
  readonly VITE_WAGER_SPONSOR_SIGNER_URL?: string;
  readonly VITE_WAGER_SPONSOR_STATUS?: string;
  readonly VITE_WAGER_ESCROW_PROGRAM_ID?: string;
  readonly VITE_WAGER_ASSET_MINT?: string;
  readonly VITE_WAGER_ASSET_SYMBOL?: string;
  readonly VITE_WAGER_ASSET_DECIMALS?: string;
  readonly VITE_WAGER_TOKEN_PROGRAM_ID?: string;
  readonly VITE_WAGER_PRESET_STAKES?: string;
  readonly VITE_WAGER_PRESET_STAKES_SOL?: string;
  readonly VITE_WAGER_MAX_STAKE_UNITS?: string;
  readonly VITE_WAGER_MAX_STAKE_SOL?: string;
  readonly VITE_WAGER_HOLD_GATE_ENABLED?: string;
  readonly VITE_WAGER_HOLD_MINT?: string;
  readonly VITE_WAGER_HOLD_SYMBOL?: string;
  readonly VITE_WAGER_HOLD_DECIMALS?: string;
  readonly VITE_WAGER_HOLD_TOKEN_PROGRAM_ID?: string;
  readonly VITE_WAGER_HOLD_MIN_UNITS?: string;
  readonly VITE_WAGER_HOLD_MIN_RAW?: string;
  readonly VITE_WAGER_GAME_ID?: string;
  readonly VITE_WAGER_RULES_HASH?: string;
  readonly VITE_WAGER_CONTEST_TTL_SECONDS?: string;
  readonly VITE_WAGER_FEE_AUTHORITY?: string;
  readonly VITE_ENABLE_DEV_WALLET?: string;
  readonly VITE_ENABLE_ARENA_THEMES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
