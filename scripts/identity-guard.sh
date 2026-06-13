#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
TARGET="${2:-}"
FAILURES=0

record_failure() {
  printf 'identity-guard: %s\n' "$*" >&2
  FAILURES=$((FAILURES + 1))
}

is_allowed_name() {
  case "$1" in
    "ChessBlox Team"|"GitHub"|"web-flow"|"github-actions[bot]"|"dependabot[bot]")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_allowed_email() {
  case "$1" in
    team@chessblox.invalid|noreply@github.com|"41898282+github-actions[bot]@users.noreply.github.com"|"49699333+dependabot[bot]@users.noreply.github.com")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

check_identity() {
  local label="$1"
  local name="$2"
  local email="$3"

  if ! is_allowed_name "$name"; then
    record_failure "$label name is not the approved team identity or a platform bot."
  fi

  if ! is_allowed_email "$email"; then
    record_failure "$label email is not the unlinked project identity or an approved platform bot."
  fi
}

scan_text_for_emails() {
  local label="$1"
  local text="$2"
  local emails

  emails="$(printf '%s\n' "$text" | grep -Eio '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' || true)"
  while IFS= read -r email; do
    [ -z "$email" ] && continue
    if ! is_allowed_email "$email"; then
      record_failure "$label contains a non-anonymous email (value redacted)."
    fi
  done <<< "$emails"
}

check_identity_file() {
  local kind="$1" source="$2" key expected actual
  for key in user.name user.email user.useconfigonly commit.gpgsign tag.gpgsign; do
    case "$key" in
      user.name) expected='ChessBlox Team' ;;
      user.email) expected='team@chessblox.invalid' ;;
      user.useconfigonly) expected=true ;;
      *) expected=false ;;
    esac
    actual="$(git config "$kind" "$source" --get "$key" 2>/dev/null || true)"
    if [ "$actual" != "$expected" ]; then
      record_failure "identity file $key does not match the approved team policy (value redacted)."
    fi
  done
}

check_config() {
  check_identity_file --file .gitidentity
  if git rev-parse --verify :.gitidentity >/dev/null 2>&1; then check_identity_file --blob :.gitidentity; fi
  local name
  local email
  local sign_commits
  local sign_tags

  name="$(git config --local --get user.name || true)"
  email="$(git config --local --get user.email || true)"
  sign_commits="$(git config --get commit.gpgsign || true)"
  sign_tags="$(git config --get tag.gpgsign || true)"

  if [ -z "$name" ] || [ -z "$email" ]; then
    record_failure "local git user.name/user.email are not configured. Run 'npm run setup:anonymous-git'."
  else
    check_identity "local git config" "$name" "$email"
  fi

  for role in AUTHOR COMMITTER; do
    identity="$(git var "GIT_${role}_IDENT")"
    effective_name="${identity%% <*}"
    effective_email="${identity#*<}"
    effective_email="${effective_email%%>*}"
    check_identity "effective $role" "$effective_name" "$effective_email"
  done

  if [ "$(git config --get core.hooksPath || true)" != ".githooks" ]; then
    record_failure "repository hooks are not installed."
  fi

  if [ "$sign_commits" = "true" ]; then
    record_failure "commit.gpgsign is enabled; signatures can reveal identity. Run 'npm run setup:anonymous-git'."
  fi

  if [ "$sign_tags" = "true" ]; then
    record_failure "tag.gpgsign is enabled; signatures can reveal identity. Run 'npm run setup:anonymous-git'."
  fi
}

check_message_file() {
  local message_file="$1"
  local text

  text="$(cat "$message_file")"
  scan_text_for_emails "commit message" "$text"
}

is_verified_github_signature() {
  local sha="$1"
  local repo="${GITHUB_REPOSITORY:-}"
  local verified
  [ "$(git show -s --format=%cn "$sha")" = "GitHub" ] || return 1
  [ "$(git show -s --format=%ce "$sha")" = "noreply@github.com" ] || return 1
  command -v gh >/dev/null 2>&1 || return 1
  if [ -z "$repo" ]; then repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" || return 1; fi
  verified="$(gh api "repos/$repo/commits/$sha" --jq '.commit.verification.verified == true and .commit.verification.reason == "valid" and .committer.login == "web-flow" and .commit.committer.email == "noreply@github.com"' 2>/dev/null)" || return 1
  [ "$verified" = "true" ]
}

check_commits() {
  local range="$1"
  local commits

  commits="$(git rev-list "$range")"
  if [ -z "$commits" ]; then
    return 0
  fi

  while IFS= read -r sha; do
    [ -z "$sha" ] && continue
    if git cat-file commit "$sha" | sed '/^$/q' | grep -q '^gpgsig'; then
      if ! is_verified_github_signature "$sha"; then
        record_failure "commit $sha has a signature that is not verified as GitHub platform-generated."
      fi
    fi
    check_identity_file --blob "$sha:.gitidentity"
    check_identity "commit $sha author" "$(git show -s --format=%an "$sha")" "$(git show -s --format=%ae "$sha")"
    check_identity "commit $sha committer" "$(git show -s --format=%cn "$sha")" "$(git show -s --format=%ce "$sha")"
    scan_text_for_emails "commit $sha message" "$(git show -s --format=%B "$sha")"
  done <<< "$commits"
}

case "$MODE" in
  config)
    check_config
    ;;
  message)
    if [ -z "$TARGET" ]; then
      record_failure "missing commit message file."
    else
      check_message_file "$TARGET"
    fi
    ;;
  tag)
    raw="$(git cat-file tag "$TARGET")"
    tagger="$(printf '%s\n' "$raw" | sed -n 's/^tagger //p')"
    tag_name="${tagger%% <*}"
    tag_email="${tagger#*<}"
    tag_email="${tag_email%%>*}"
    check_identity "tagger" "$tag_name" "$tag_email"
    scan_text_for_emails "tag" "$raw"
    if printf '%s\n' "$raw" | grep -Eq 'BEGIN (PGP|SSH) SIGNATURE'; then record_failure "signed tag is not allowed."; fi
    ;;
  commits)
    if [ -z "$TARGET" ]; then
      record_failure "missing commit range."
    else
      check_commits "$TARGET"
    fi
    ;;
  *)
    printf 'Usage: %s {config|message FILE|commits RANGE}\n' "$0" >&2
    exit 2
    ;;
esac

if [ "$FAILURES" -gt 0 ]; then
  exit 1
fi
