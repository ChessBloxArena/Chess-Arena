#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
SCANNER="$ROOT/.local/bin/gitleaks"
if [ ! -x "$SCANNER" ]; then SCANNER="$(command -v gitleaks || true)"; fi
if [ -z "$SCANNER" ]; then echo 'Install the local scanner with npm run setup:security.' >&2; exit 1; fi
if [ "${1:-staged}" = staged ]; then
  # Scan the entire index, not the working tree or only added diff lines.
  SNAPSHOT="$(mktemp -d)"
  trap 'rm -rf "$SNAPSHOT"' EXIT
  git checkout-index --all --prefix="$SNAPSHOT/"
  "$SCANNER" dir "$SNAPSHOT" --config "$ROOT/.gitleaks.toml" --redact --no-banner
elif [ "${1:-}" = commits ] && [ -n "${2:-}" ]; then
  "$SCANNER" git "$ROOT" --config "$ROOT/.gitleaks.toml" --redact --no-banner --log-opts="$2"
else
  echo 'Usage: secret-scan.sh {staged|commits RANGE}' >&2; exit 2
fi
