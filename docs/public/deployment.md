# Railway deployment

## Release order

1. Keep feature branches, dependency updates, and their review in the private `ChessBloxArena/Chess-Arena-development` repository. Local `origin` should point there; use an explicitly named `public` remote for the public release mirror.
2. Run CI, identity checks, publication checks, and secret scanning on the private candidate. Deploy its reviewed Git snapshot to the intended Railway environment, wait for success, and verify the live deployment. Record the source revision, deployment ID, target environment, and test results privately.
3. Only after that verification, open a public release pull request containing the reviewed release. Preserve the public Dependabot limits of zero; enable dependency proposals only in private development. Merge after the public checks pass, then delete the temporary release branch. Do not push development branches, internal evidence, or all local refs to the public remote.

A preview deployment verifies only the preview's configuration and features. It does not verify production backend migrations or funded settlement. Railway deployments currently use explicit CLI uploads; merging a repository branch alone does not deploy it.

## Public preview

The [public preview](https://public-preview-public-preview.up.railway.app) is an isolated web service in the `public-preview` environment. It has no production backend credentials and leaves real-money entry disabled. It exercises CPU practice, the production build, runtime assets, routing, and health checks.

## Web service

1. Create a Railway service from this repository, or link a local checkout with `railway link`.
2. Use Node.js 22 and the root `railway.toml`. It selects Railpack, `npm run build`, `npm start`, and the `/health` readiness check. The server listens on Railway's `PORT` and `0.0.0.0`.
3. Set `CHESS_ARENA_SERVICE_ROLE=web`. For a practice preview, leave Supabase variables unset. Keep `VITE_WAGER_NEW_WAGERS_ENABLED=false`, `VITE_WAGER_REAL_ESCROW_ENABLED=false`, and `VITE_AUTOMATIC_RBLX_PAYOUT_ENABLED=false`.
4. For online play, configure your own `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` before building. Never put backend credentials in browser-prefixed variables.
5. Deploy to an explicit target and create a Railway domain:

```sh
railway up --service <web-service> --environment <environment> --detach
railway domain --service <web-service> --environment <environment>
railway deployment list --service <web-service> --environment <environment> --json
```

`railway up --detach` confirms submission, not deployment success. Wait for Railway to report success, then verify the URL. The included test can check a running deployment:

```sh
DEPLOY_URL=https://your-service.up.railway.app npm run test:deploy
```

The smoke test checks `/health`, the app shell, deep-link fallback, a production JavaScript asset, soundtrack MIME type, missing assets, and method handling. Also open the lobby and complete a CPU move/reply in a browser. With no `DEPLOY_URL`, the test starts and stops a local production server after `npm run build`.

## Backend release order

Before promoting this frontend to an existing online environment, verify that all required Supabase migrations have been applied, including `20260908201905_saved_play_consent.sql`, and deploy the matching `pvp-referee` function. This source import does not apply production migrations.

Keep legacy escrow configuration for existing matches. Automatic RBLX entry additionally requires a separately deployed and verified V2 contract, compatible referee and worker configuration, and wallet-authorized end-to-end validation. Publishing the web app must not enable these features implicitly.

## Settlement worker

Run the settlement worker as a separate service with backend-only secrets. Select `/railway.worker.toml` as that service's Railway config file; the web config's HTTP health check does not apply to a background worker. The worker config selects the Robinhood worker. A legacy Solana deployment must deliberately choose its matching start command and payment configuration.

Do not duplicate a production environment with a live settlement worker merely to preview the UI. Use an isolated web service without copied secrets. Do not run multiple settlement replicas without validating the worker's coordination semantics.

## Files and credentials

Deploy the reviewed Git snapshot. `.railwayignore` additionally excludes internal documents, recordings, local configuration, exports, and development output. Public artwork and music are required runtime files. GitHub history and local credentials are not required deployment inputs.

The repository includes no production credentials. Keep provider credentials in the appropriate account secret store and use your own project identifiers. The optional production setup script requires `SUPABASE_PROJECT_REF`; review its actions before running it.
