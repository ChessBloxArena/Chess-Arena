export type GameEscrowInstructionName =
  | "initialize_global_config"
  | "register_game"
  | "update_game_config"
  | "create_contest"
  | "create_native_contest"
  | "join_contest"
  | "join_native_contest"
  | "cancel_contest"
  | "cancel_native_contest"
  | "refund_expired_contest"
  | "refund_expired_native_contest"
  | "settle_contest"
  | "reclaim_contest_rent"
  | "settle_native_contest"
  | "initialize_prize_pool"
  | "publish_prize_results"
  | "claim_prize";

export type GameEscrowIdlInstruction = {
  name: GameEscrowInstructionName;
  accounts: string[];
  args: string[];
};

export const GAME_ESCROW_IDL_SHAPE = {
  name: "game_escrow",
  instructions: [
    {
      name: "create_contest",
      accounts: [
        "global_config",
        "game_config",
        "mint",
        "contest",
        "contest_vault",
        "vault_authority",
        "creator_token_account",
        "creator",
        "token_program",
        "system_program"
      ],
      args: ["contest_id", "mint", "stake_amount", "rules_hash", "expires_at"]
    },
    {
      name: "create_native_contest",
      accounts: [
        "global_config",
        "game_config",
        "native_contest",
        "creator",
        "rent_payer",
        "system_program"
      ],
      args: ["contest_id", "stake_amount", "rules_hash", "expires_at"]
    },
    {
      name: "join_contest",
      accounts: [
        "global_config",
        "game_config",
        "mint",
        "contest",
        "contest_vault",
        "vault_authority",
        "joiner_token_account",
        "joiner",
        "token_program"
      ],
      args: []
    },
    {
      name: "join_native_contest",
      accounts: [
        "global_config",
        "game_config",
        "native_contest",
        "joiner",
        "system_program"
      ],
      args: []
    },
    {
      name: "cancel_contest",
      accounts: [
        "contest",
        "mint",
        "contest_vault",
        "vault_authority",
        "creator_token_account",
        "creator",
        "token_program"
      ],
      args: []
    },
    {
      name: "cancel_native_contest",
      accounts: ["native_contest", "creator", "rent_recipient"],
      args: []
    },
    {
      name: "refund_expired_contest",
      accounts: [
        "contest",
        "mint",
        "contest_vault",
        "vault_authority",
        "creator_token_account",
        "joiner_token_account",
        "token_program"
      ],
      args: []
    },
    {
      name: "refund_expired_native_contest",
      accounts: ["native_contest", "creator", "joiner", "rent_recipient"],
      args: []
    },
    {
      name: "settle_contest",
      accounts: [
        "global_config",
        "game_config",
        "fee_authority",
        "mint",
        "contest",
        "contest_vault",
        "vault_authority",
        "result_authority",
        "winner_token_account",
        "creator_refund_token_account",
        "joiner_refund_token_account",
        "fee_token_account",
        "token_program"
      ],
      args: ["winner", "result_hash"]
    },
    {
      name: "reclaim_contest_rent",
      accounts: [
        "contest",
        "mint",
        "contest_vault",
        "vault_authority",
        "rent_recipient",
        "token_program"
      ],
      args: []
    },
    {
      name: "settle_native_contest",
      accounts: [
        "global_config",
        "game_config",
        "fee_authority",
        "native_contest",
        "result_authority",
        "creator",
        "joiner",
        "rent_recipient"
      ],
      args: ["winner", "result_hash"]
    },
    {
      name: "initialize_prize_pool",
      accounts: [
        "global_config",
        "game_config",
        "prize_pool",
        "prize_vault",
        "prize_authority",
        "mint",
        "token_program",
        "system_program"
      ],
      args: ["season_id", "season_starts_at", "season_ends_at"]
    },
    {
      name: "publish_prize_results",
      accounts: [
        "global_config",
        "game_config",
        "prize_pool",
        "prize_authority"
      ],
      args: ["season_id", "result_hash", "top_ten_count"]
    },
    {
      name: "claim_prize",
      accounts: [
        "global_config",
        "game_config",
        "prize_pool",
        "prize_vault",
        "claimant",
        "claimant_token_account",
        "mint",
        "token_program"
      ],
      args: ["season_id", "rank", "amount_raw", "proof"]
    }
  ] satisfies GameEscrowIdlInstruction[]
} as const;
