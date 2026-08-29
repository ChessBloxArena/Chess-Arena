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

missing=0

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing: $1"
    missing=1
  else
    echo "ok: $1 ($(command -v "$1"))"
  fi
}

need solana
need anchor
need cargo

if [ "${VITE_SOLANA_CLUSTER:-mainnet-beta}" != "mainnet-beta" ]; then
  echo "bad config: VITE_SOLANA_CLUSTER must be mainnet-beta"
  missing=1
fi

if [ -z "${VITE_WAGER_ESCROW_PROGRAM_ID:-}" ]; then
  echo "missing: VITE_WAGER_ESCROW_PROGRAM_ID"
  missing=1
fi

if [ -z "${PVP_WAGER_ESCROW_PROGRAM_ID:-}" ]; then
  echo "missing: PVP_WAGER_ESCROW_PROGRAM_ID"
  missing=1
fi

if [ -z "${PVP_REFEREE_SERVICE_TOKEN_SHA256:-}" ]; then
  echo "missing: PVP_REFEREE_SERVICE_TOKEN_SHA256"
  missing=1
fi

if [ "${VITE_WAGER_NEW_WAGERS_ENABLED:-false}" = "true" ] || [ "${VITE_WAGER_REAL_ESCROW_ENABLED:-false}" = "true" ]; then
  echo "warning: browser wager kill switches are enabled in this shell"
fi

if [ "${PVP_WAGER_QUEUE_ENABLED:-false}" = "true" ] || [ "${PVP_WAGER_SETTLEMENT_ENABLED:-false}" = "true" ]; then
  echo "warning: referee wager kill switches are enabled in this shell"
fi

exit "$missing"
