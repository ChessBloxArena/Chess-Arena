#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
VERSION=8.30.1
case "$(uname -s)" in Darwin) OS=darwin;; Linux) OS=linux;; *) echo 'Use Gitleaks 8.30.1 on PATH on this platform.' >&2; exit 1;; esac
case "$(uname -m)" in arm64|aarch64) ARCH=arm64;; x86_64) ARCH=x64;; *) echo 'Unsupported architecture' >&2; exit 1;; esac
mkdir -p .local/bin
ARCHIVE="gitleaks_${VERSION}_${OS}_${ARCH}.tar.gz"
BASE="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}"
curl --fail --silent --show-error --location "$BASE/$ARCHIVE" -o ".local/bin/$ARCHIVE"
curl --fail --silent --show-error --location "$BASE/gitleaks_${VERSION}_checksums.txt" -o .local/bin/checksums.txt
node --input-type=module - "$ARCHIVE" <<'JS'
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const name = process.argv[2];
const entry = readFileSync('.local/bin/checksums.txt', 'utf8').split('\n').find(line => line.trim().split(/\s+/)[1] === name);
const actual = createHash('sha256').update(readFileSync(`.local/bin/${name}`)).digest('hex');
if (!entry || entry.split(/\s+/)[0] !== actual) throw new Error('Gitleaks checksum mismatch');
JS
tar -xzf ".local/bin/$ARCHIVE" -C .local/bin gitleaks
chmod +x .local/bin/gitleaks
.local/bin/gitleaks version
