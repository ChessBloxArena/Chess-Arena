# Security and publication policy

Report vulnerabilities through this repository's **Security → Report a vulnerability** tab. Do not put credentials, wallet data, or exploit details in public issues.

## What is published

Application source, contract source, database migrations, synthetic tests, runtime artwork, and curated documentation in `docs/public/` are public. Internal operations notes, exports, recordings, local configuration, keys, database dumps, and office documents are excluded. Asset attribution remains alongside the assets.

The publication guard checks the Git index before commit and every reachable file revision before push. Gitleaks checks the staged snapshot and outgoing history. Both checks run in CI. GitHub secret scanning and push protection provide another layer. These pattern-based controls cannot guarantee anonymity or detect every confidential document; review the staged diff before publishing.

## Git identity

Use `Anonymous Dev` with your GitHub noreply address. Run `npm run setup:anonymous-git` after cloning. The guards validate effective author/committer values (including environment overrides), commit messages, outgoing annotated tags, and signatures. Commit/tag signing is disabled locally to avoid exposing signing identities. GitHub-generated merge and bot commits may carry a platform signature: the guard permits it only when GitHub verifies the signature and attributes the committer to its `web-flow` account with `noreply@github.com`. Unknown signatures and unavailable verification fail closed. Your GitHub account, public activity, and contribution links remain visible.

Hooks are repository-local and can be bypassed by Git flags. CI detects violations after upload; it cannot undo a disclosure. Do not bypass hooks to publish a failing snapshot. Branch protection and GitHub push protection are managed in repository settings.

## Runtime secrets

Every `VITE_*` variable is public browser configuration. Keep service-role credentials, RPC credentials, signing keys, and Uniswap keys exclusively in the appropriate backend secret store. `.env.example` contains placeholders and disabled feature switches.

If a secret is exposed, revoke or rotate it immediately, then remove it from source and coordinate history cleanup. Deleting a file or making a repository private does not revoke a leaked secret.

## Financial features

Contract and settlement code is included for review and development. The preview deployment does not certify live funds, contract safety, liquidity, eligibility, or end-to-end payouts. Keep wager switches off until backend migrations, referee compatibility, deployed contracts, and wallet-authorized flows have been verified.
