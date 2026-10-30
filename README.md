# Match Generator

Hono API running on Cloudflare Workers for AniMasters. This modernization preserves the current local-player game API; multiplayer rooms are a later step.

## Development

Use Node.js 24.18.0 (`.nvmrc`) and npm. `package-lock.json` is the authoritative lockfile for this repository.

```sh
nvm use
npm ci
npm run dev
```

For Wi-Fi multiplayer testing, run `npm run dev:lan` here and `yarn dev:lan` in `animasters`. This command keeps Wrangler on loopback port 8787 and permits exact HTTPS frontend origins for this Mac’s current addresses. Complete the certificate setup and device trust steps in the frontend’s `docs/local-https.md` first. The CLI override does not change deployed origins or `.dev.vars`.

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

## Anime catalog import

The additive catalog importer and explicit season mappings are documented in [catalog/README.md](catalog/README.md). It adds stable answer IDs, aliases and source artwork URLs without changing the current game API. Run `npm run test:catalog` for its Node tests; `npm test` continues to exercise the Worker API.

## Multiplayer lobby

`src/rooms/routes.ts` adds `POST /rooms` (nickname), `POST /rooms/:code/join` (nickname), authenticated `GET /rooms/:code/session`, and `GET /rooms/:code/connect` for WebSockets. JSON entry responses contain a public room snapshot plus the caller's private player ID/token. Snapshot broadcasts never include credentials. Errors use readable JSON with CORS headers; existing endpoints keep their original contracts.

`src/rooms/room.ts` exports the `Room` Durable Object. Its embedded SQLite record owns each four-character code and roster, with collision-safe reservation, at most ten players, case-insensitive nickname uniqueness, private reconnect credentials and hibernatable sockets. Joining/creating requires a nickname of 1–24 Unicode code points after trimming/NFC normalization. HTTP session checks authenticate with `Authorization: Bearer <token>`. WebSockets offer `animasters, token.<token>` as protocols; the selected protocol is only `animasters`. Never log credentials or put them in share URLs.

Wrangler defines the `ROOMS` binding for both existing deployment targets and a new `v1-rooms` migration using `new_sqlite_classes`. Deploy to the same target as before; do not edit migration history after deployment. `ROOM_ORIGINS` is a comma-separated WebSocket origin allowlist (the Pages site by default, with explicit local development origins in the top-level configuration). Add exact preview/custom origins if needed. No Neon migration or storage upload is required for this lobby slice.

For local verification run `npx wrangler dev --local --port 8788`; start the frontend with `VITE_API_URL=http://127.0.0.1:8788`. Local Durable Object data stays in Wrangler's ignored local state. `npm test` covers collision retries, capacity, input validation, credential isolation, socket replacement, hibernation and expiry alarms alongside the legacy API tests. Unfinished rooms expire after thirty minutes with nobody connected; completed rooms expire thirty minutes after completion. No host transfer or automatic slot release is implemented.

## Multiplayer gameplay

`src/rooms/game.ts` contains the deterministic round rules and explicit public snapshot projection. `room.ts` persists those rules in SQLite, authenticates commands, serializes mutations and schedules alarms. `match.ts` queries existing songs with canonical answer IDs and samples the configured count without repeated canonical anime; the old generation endpoint is unchanged. New room defaults are 10 songs and all song types enabled.

WebSocket game messages use `v: 1`: `ready` supplies `catalogVersion` (and `roundId` between rounds); `guess` supplies `roundId`, a unique `actionId`, and a selected `animeId` or null for pass. `clock` echoes a client `sentAt` with server time for scheduling only. Snapshots acknowledge final personal submissions without disclosing correctness until reveal. Unknown IDs, second attempts, stale rounds and deadline-boundary guesses are rejected. Per-room preparation tokens prevent duplicate generation; a thirty-second preparation timeout returns the room to the lobby. Alarms cover countdowns, guessing, preparation and expiry, with request-time checks for delayed alarms.

Generate/verify the server's immutable catalog projection with `node scripts/catalog/game-catalog.mjs ../animasters/public/catalog`. It validates the published SHA-256 and includes only stable IDs/titles, never song availability. Keep the current version's import and historical projection immutable; supporting another revision requires dispatch by the stored room catalog version before changing the default. No Neon schema migration is required for gameplay. Existing lobbies are hydrated additively, retaining player credentials.

Media still comes directly from the existing public Supabase bucket. Current filenames contain titles and metadata sanitization is pending; hiding private JSON fields alone does not meet the planned answer-privacy goal. Tests use fixture audio URLs, and local browser verification uses actual public audio and read-only catalog access. Nothing here modifies remote song records or files.

### Lobby preference commands

`{ v: 1, type: "settings", settingsRevision, settings: { amount, includeOpenings, includeEndings, includeSoundtracks } }` changes preferences only for the authenticated host in the lobby or after completion. Counts must be integers from 1 to 999; type flags must be booleans. `repeatAnimes` stays false. All unchecked types select all three existing categories, preserving manual-game behavior. Snapshots include `settingsRevision`; changed saves increment it and reset readiness. Identical retries are no-ops.

Lobby `ready` messages include the observed `settingsRevision` (missing revisions only match an untouched revision-zero lobby). Stale readiness and stale edits are rejected. `unready` withdraws the player's readiness in the lobby or after completion. Settings lock as soon as preparation starts; the existing generator receives the saved settings. `MatchAvailabilityError` exposes only the eligible-count explanation, while database errors remain generic. No new migration is needed; old lobbies hydrate revision zero.

### Playing again

After completion, `{ v: 1, type: "ready-next-match", completedRoundId, catalogVersion, settingsRevision }` opts into another match. The final result's round ID binds this consent to a specific completed match; ordinary round/lobby Ready messages cannot start rematches. Persisted `readyForNextMatch` markers also prevent older deployed rooms' final-round readiness from counting as rematch consent. Reconnection clears readiness. All connected players must opt in; disconnected members retain their slots and credentials without blocking preparation. New joins remain disabled after the initial lobby.

Standings remain intact during preparation. A successful generation clears previous scores, submissions, reveal and completion time, then starts a full ten-second first-song countdown. Failure or the thirty-second preparation timeout restores the completed screen, clears readiness and preserves the original completion time. The previous completion expiry is suspended during preparation and removed on success; the next completed match gets its own thirty-minute retention period. No database schema migration is needed.
