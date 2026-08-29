#!/usr/bin/env bash
set -euo pipefail

SOLANA_BIN_DIR="${HOME}/.local/share/solana/install/active_release/bin"
AVM_BIN_DIR="${HOME}/.avm/bin"

if [ -d "$SOLANA_BIN_DIR" ]; then
  export PATH="$SOLANA_BIN_DIR:$PATH"
fi

if [ -d "$AVM_BIN_DIR" ]; then
  export PATH="$AVM_BIN_DIR:$PATH"
fi

if ! command -v anchor >/dev/null 2>&1; then
  echo "Anchor CLI is required to build the escrow program."
  exit 1
fi

if [ "${VITE_SOLANA_CLUSTER:-mainnet-beta}" != "mainnet-beta" ]; then
  echo "Refusing to build with a non-mainnet launch cluster in VITE_SOLANA_CLUSTER."
  exit 1
fi

anchor build --no-idl --program-name game_escrow
mkdir -p target/deploy
if [ ! -f programs/game-escrow/target/deploy/game_escrow.so ]; then
  echo "Escrow SBF artifact was not produced."
  exit 1
fi
cp programs/game-escrow/target/deploy/game_escrow.so target/deploy/game_escrow.so
PROGRAM_ID="$(solana address -k target/deploy/game_escrow-keypair.json)"
if ! grep -q "$PROGRAM_ID" programs/game-escrow/src/lib.rs Anchor.toml; then
  echo "Built program key $PROGRAM_ID is not synced with declare_id/Anchor.toml."
  echo "Run: anchor keys sync"
  exit 1
fi
echo "Escrow build complete. Review the generated program id before any approved mainnet deploy."
