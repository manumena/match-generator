# Match Generator

Hono API running on Cloudflare Workers for AniMasters. This modernization preserves the current local-player game API; multiplayer rooms are a later step.

## Development

Use Node.js 24.18.0 (`.nvmrc`) and npm. `package-lock.json` is the authoritative lockfile for this repository.

```sh
nvm use
npm ci
npm run dev
```

The local Worker listens on `http://localhost:8787`. Existing local `.dev.vars` configuration is reused. Keep database credentials in that ignored file or in Cloudflare secrets; never commit them.

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm start` | Run Wrangler locally. |
| `npm run typegen` | Regenerate `worker-configuration.d.ts` for the configured runtime date. |
| `npm run typecheck` | Check application, tests, and configuration types. |
| `npm run lint` | Run ESLint. |
| `npm test` | Run regression tests inside the Cloudflare Worker runtime. |
| `npm run test:watch` | Watch tests during development. |
| `npm run build` | Type-check and bundle into `dist/` with `wrangler deploy --dry-run`; does not deploy. |
| `npm run deploy` | Deploy using Wrangler's current command. |

Runtime types are generated without environment bindings to avoid coupling public types to local secrets. Application bindings are declared in `src/env.ts`.

## Existing API contract

| Request | Response |
| --- | --- |
| `GET /` or `GET /hi` | HTTP 200, text `Hi`. |
| `GET /generate-match` | HTTP 200, JSON `{ "match": [/* complete song records */] }`. |
| `OPTIONS` on any path | HTTP 204, empty body, wildcard CORS headers with a one-day max age. |
| Unknown path or unsupported method (including `HEAD`) | HTTP 404, empty body. |

`generate-match` accepts `amount`, `repeatAnimes`, `includeOpenings`, `includeEndings`, and `includeSoundtracks`. Omitted parameters use environment defaults. Amount uses the existing `parseInt` behavior; booleans are true only for the exact string `true`. Duplicate parameters use the last value. Trailing and repeated path slashes are accepted. Successful responses retain the existing wildcard CORS headers and content types.

Match generation still caps selection at available songs/anime. With repeated anime disabled it selects one song per selected anime. With repeats enabled it selects unique song IDs and keeps the database result order. Disabling every song type still falls back to all types. The schema, database connection, SQL queries, selection algorithm, and returned media paths are unchanged.

## Configuration and deployment

`wrangler.toml` retains the existing account, Worker name, and named `production` environment. The tested compatibility date is `2026-10-19`.

Bindings used by the app: `DATABASE`, `DB_USERNAME`, `DB_HOST`, `DB_PASSWORD`, `DEFAULT_SONGS_AMOUNT`, `DEFAULT_REPEAT_ANIMES`, `DEFAULT_INCLUDE_OPENINGS`, `DEFAULT_INCLUDE_ENDINGS`, and `DEFAULT_INCLUDE_SOUNDTRACKS`.

The existing configuration defines defaults only under `[env.production.vars]`. The top-level Worker and named environment are separate deployment targets. Use the same environment as the existing deployment; do not switch targets merely because one is named production. Examples, once the intended target is established:

```sh
npm run build -- --env production
npm run deploy -- --env production
```

Use `--env=""` to explicitly target the top-level Worker. This migration does not move bindings, change secret values, or deploy either target.

## Compatibility notes

- Hono 4.13.13 replaces `@tsndr/cloudflare-worker-router`; a small middleware layer preserves legacy CORS, HEAD, and error responses.
- Wrangler 4.152.0, TypeScript 6.0.3, ESLint, and Vitest 5.0.5 replace the old toolchain. Tests use `@cloudflare/vitest-plugin` 1.4.7 with fake bindings and mocked database results, without reading `.dev.vars` or contacting the database.
- The Neon HTTP driver stays pinned to the previously locked `0.10.1`; upgrading the driver is a separate change.
- The environment-object log was removed because it included database credentials. No credentials are printed during normal match generation.
- Known behavior intentionally retained: configuration uses singular `DEFAULT_INCLUDE_SOUNDTRACK`, while application code reads plural `DEFAULT_INCLUDE_SOUNDTRACKS`. An absent plural value means false. No automatic alias or default correction is introduced.
- Database errors still produce HTTP 200 with `{}` because the generator returns undefined. Strict input validation and error-status fixes are separate behavior changes.

The initial 28 regression tests passed against the original implementation before the router migration; those tests plus two full request-to-generator cases now cover the modernized Worker. The production-environment dry-run build, type checking, lint, and all 30 tests passed. A separate local Wrangler smoke test using the existing database returned two songs from distinct anime with the expected response schema. No remote deployment was performed.

Private pre-migration backups of both repositories are in the frontend repository at `.local-backups/2026-10-22-pre-frontend-migration/`, including recovery instructions. They are local archives, not database or cloud-storage backups.
