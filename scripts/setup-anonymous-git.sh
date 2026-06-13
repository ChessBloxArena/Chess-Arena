#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# Do not infer this identity from gh: account-specific noreply addresses link
# commits to the publishing account. .invalid cannot receive verification mail.
NAME="$(git config --file .gitidentity --get user.name)"
EMAIL="$(git config --file .gitidentity --get user.email)"
if [ "$NAME" != "ChessBlox Team" ] || [ "$EMAIL" != "team@chessblox.invalid" ]; then
  echo 'Identity setup blocked: .gitidentity must contain the approved team identity.' >&2
  exit 1
fi

git config --local user.name "$NAME"
git config --local user.email "$EMAIL"
git config --local user.useConfigOnly true
git config --local commit.gpgsign false
git config --local tag.gpgsign false
git config --local core.hooksPath .githooks

bash scripts/identity-guard.sh config

printf 'Configured ChessBlox team identity for this repo:\n'
printf '  user.name=%s\n' "$(git config --get user.name)"
printf '  user.email=%s\n' "$(git config --get user.email)"
printf '  core.hooksPath=%s\n' "$(git config --get core.hooksPath)"
