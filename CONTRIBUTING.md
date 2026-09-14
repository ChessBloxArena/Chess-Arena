# Contributing

Use Node.js 22 and npm. The npm lockfile is authoritative.

Development branches and dependency-update pull requests belong in the private
`ChessBloxArena/Chess-Arena-development` repository. The public repository is a
release mirror. Deploy and verify a candidate from private development before
opening a public release pull request. See [release order](docs/public/deployment.md#release-order).

```sh
npm run setup:anonymous-git
npm run setup:security
npm ci
npm run dev
```

Local CPU practice works without backend credentials. Configure your own Supabase project for online features; see [deployment](docs/public/deployment.md).

Before opening a pull request:

```sh
npm run test:guards
npm run lint
npm test
npm run build
npm run test:deploy
npm run supabase:functions:check
git add <reviewed-files>
npm run security:check
git diff --cached --stat
```

Use pseudonymous commit metadata and keep changes focused. Never upload local operations notes, production evidence, credentials, or personal data. New public documentation belongs under `docs/public/` and should contain portable instructions and placeholders. Preserve third-party attribution.

The repository does not currently grant an open-source license; public visibility alone is not a license grant. Discuss distribution and asset reuse with the maintainer.
