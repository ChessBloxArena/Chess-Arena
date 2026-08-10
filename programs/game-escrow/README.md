# Game Escrow Program

`game_escrow` is the generic Solana escrow program for contest-based games. It stores game configuration, supported mint terms, contest lifecycle state, and trusted-result settlement metadata. It does not validate gameplay rules.

## Current Phase

The Phase 10 program shape includes Anchor accounts, instruction handlers, validation errors, token-interface CPI transfers, and unit-testable validation helpers. It supports SPL Token and Token-2022 compatible mints through `anchor_spl::token_interface`, plus a sponsored native SOL contest lane for launch UX experiments.

## Flow

1. `initialize_global_config` creates the admin-controlled global config.
2. `register_game` creates a reusable game config for a `game_id`, result authority, mint, fee terms, and max stake.
3. `update_game_config` pauses/unpauses the game and updates result authority, mint enablement, fees, and stake caps for new contests.
4. `create_contest` creates a generic contest record and transfers the creator stake into the contest vault.
5. `join_contest` transfers the joiner stake into the vault and activates the contest.
6. `cancel_contest` allows the creator to cancel before another player joins and refunds the creator stake.
7. `refund_expired_contest` refunds the creator, plus the joiner when the contest had become active.
8. `settle_contest` trusts the configured result authority, prevents double settlement, stores a result hash, pays the winner minus any platform fee, and treats an omitted winner as a draw refund.

## Sponsored Native SOL Lane

The native SOL path uses a separate `NativeContest` account so the existing SPL/wSOL contest layout remains compatible.

1. `create_native_contest` creates a `native_contest` PDA with `rent_payer` as the account sponsor and transfers exactly the creator stake into the contest account.
2. `join_native_contest` transfers exactly the joiner stake into the same contest account and activates the contest.
3. `cancel_native_contest`, `refund_expired_native_contest`, and `settle_native_contest` return player stakes, then close the native contest account to the recorded `rent_recipient`.

The player deposit amount is program-built from `stake_amount`; there is no browser-provided overpayment amount. The recorded rent recipient is the rent payer/sponsor from creation, and terminal native instructions require that same recipient account before Anchor closes the contest.

## Localnet, Devnet, Mainnet

- Localnet: run `anchor test` after Anchor CLI and Solana CLI are installed. Do not use real keys.
- Devnet: deploy only with explicit approval and a disposable devnet keypair.
- Mainnet-beta: deploy only after explicit approval, audit, stake caps, kill switch confirmation, and a configured result authority. Do not deploy from Codex without approval.

## Verification Notes

The repository currently lacks global Anchor tooling. With Rust/Cargo available, verify the program as far as possible with:

```sh
cargo test --manifest-path programs/game-escrow/Cargo.toml
```

Full `anchor test` remains blocked until the user approves installing or exposing Anchor CLI tooling.
