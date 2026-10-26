# Versioned search delivery and curation

Implemented October 24, 2026; series-only scope and readability updates October 25. The source of truth is our Neon catalog; Manami is the initial dataset, not a live search dependency. The current game API and manual scoring/reveal flow are unchanged.

## Editable catalog layer

`002_catalog_curation.sql` adds:

- `catalog.search_metadata`: optional display title, normalized popularity (0–100, with source and timestamp), and optional editorial `search_priority` override (0–100). The effective search weight is `COALESCE(search_priority,popularity,0)`.
- `catalog.answer_redirects`: reviewed duplicate IDs pointing directly to a retained canonical ID. No source records or IDs are deleted. Curation/export tooling rejects chains and cycles.
- `catalog.answer_identity`: the original-to-canonical ID lookup, including unchanged IDs.
- `catalog.song_answers`: existing song mappings resolved through that lookup for the future multiplayer implementation. The legacy API continues using the existing songs table.
- `catalog.curation_revisions`: checksummed curation history.

`search-curation.json` seeds 56 provisional **editorial** priorities across well-known titles, including titles outside the song roster. These are not audience counts or claimed external popularity statistics. Actual `popularity` values remain unset until a permitted source and normalization method are selected. Manami ratings and song availability are never used as fame measures.

Two duplicate pairs were reviewed against the pinned source records: One Piece TV (1999), and Nanatsu no Taizai OVA (2015). Their aliases now resolve to their retained canonical IDs. The OVA remains separate from the Seven Deadly Sins TV answer in Neon and is excluded from the series-only search export. Hunter x Hunter's 1999 and 2011 adaptations have explicit display labels. Other releases show type/year in autocomplete. This is initial curation, **not** a claim that all 1,146 normalized-title collision groups have been reviewed. A matching title alone is not permission to merge works.

To validate a new seed on a test branch:

```sh
node --env-file=.dev.vars scripts/catalog/cli.mjs curate \
  --host YOUR_DIRECT_BRANCH_HOST.neon.tech --database animasters
```

Append `--apply` to apply the additive migration and seed in one transaction. Test on a branch before applying to main. Initial curation was tested twice on `catalog-import-2026-10-24`, then applied to main; every original song field remained unchanged. Existing metadata edits are preserved by repeated seeds. Do not edit an applied checksummed seed/migration; use a reviewed follow-up migration to change existing priorities, labels or redirects. No admin UI is included yet.

Future room submission validation must resolve both submitted and song IDs through `answer_identity`/`song_answers`, pin the room's catalog version, and handle catalog changes through reviewed releases. Merely having a redirect does not retroactively alter an active room's persisted answer rules. Multiplayer is not implemented by this change.

## Episode-count backfill

`003_release_episodes.sql` adds a nullable positive `episodes` count to each provider release. The initial import did not store it. Source zero/missing counts become `null`; future imports store the field directly. Existing imports can be enriched from the same checksum-pinned snapshot:

```sh
node --env-file=.dev.vars scripts/catalog/cli.mjs episodes \
  --file .catalog-cache/manami-2026-27.json \
  --host YOUR_DIRECT_BRANCH_HOST.neon.tech --database animasters --apply
```

Without `--apply`, this only validates/plans locally. Test on a branch before main. The backfill checks source identity and release coverage, then applies schema and data in one transaction. It fills missing counts only, preserving existing positive values and all answer/song identities. It never edits the old applied migrations or import inputs. Repeating it changes no already populated counts.

## Export and publication

```sh
node --env-file=.dev.vars scripts/catalog/cli.mjs export \
  --host YOUR_DIRECT_HOST.neon.tech --database animasters \
  --out ../animasters/public/catalog
```

Export runs in a read-only, repeatable-read transaction. It includes canonical answers with at least one release classified as **TV, or ONA (web) with more than one known episode**, irrespective of whether they have songs. MOVIE, OVA, SPECIAL and UNKNOWN-only answers are excluded before download. TV and web series share one search pool; format alone never merges their identities. The displayed release is chosen from eligible members, so a non-series artwork representative cannot accidentally hide an eligible group. All source releases remain in Neon. The owner accepted TV plus multi-episode web releases on October 25. ONA with one episode or an unknown count is excluded; TV remains eligible regardless of count. This is a format/count rule, not complete editorial classification: multi-part movies reported as ONA with multiple episodes may still need explicit review. It writes:

- `anime.<sha256>.json`: immutable asset, named by the hash of its exact UTF-8 bytes.
- `manifest.<sha256>.json`: immutable version-specific manifest for pinned clients.
- `manifest.json`: revalidated pointer to the current version, published last via atomic rename.
- `LICENSE.txt`: original dataset license.

The schema version is **4**, with `scope: "series"` in both payload and manifest. Each compact entry is `[id, title, aliases, effectivePriority, [format, year, episodes]]`. IDs come from Neon; aliases include redirected records and original titles when a label changes. It excludes song IDs, song availability, media paths, artwork, descriptions and current-round data. Format/year distinguish adaptations; the episode count lets the browser independently validate web-series eligibility. Unknown counts are `null`. Aliases duplicating the display title are omitted case-insensitively. Other capitalization-only variants are deduplicated in the original sorted order, preserving the first spelling used by search. See [capitalization cleanup](alias-capitalization-cleanup.md) for validation and savings.

The generated public assets live in the frontend repository, so Pages deployment needs no database credentials or import step. Build with the published files already present. No catalog query runs for a player or keystroke. `public/_headers` configures immutable one-year caching for hash-named assets and revalidation for the latest manifest. Pages serves the JSON with HTTP content negotiation; gzip/Brotli figures below are offline measurements, not a guarantee of a specific live transfer encoding.

Keep older published files when exporting a new version. Never overwrite bytes at an existing hash URL. Publish new assets and the manifest together before using that version in a room. The exporter refuses incompatible overwrites; browser loading checks schema, expected version, byte count, SHA-256, unique IDs, eligible TV/ONA formats, episode-count rules and alias counts. Unsupported/failed loading produces a retry state rather than narrowing the search catalog.

The [alias-language cleanup](alias-language-cleanup.md) removes identified unsupported-language aliases while preserving English, Spanish, Japanese/romaji and uncertain titles. The database archive is not included in the export.

## Current asset and validation

Version: `1c6fcb37341c6d74935feed490f60e02beb90dfcdb457a8249eb8b2a2fdf8ddc`.

| Measurement | Value |
| --- | ---: |
| Canonical answers | 14,872 |
| Additional aliases (excluding each display title) | 87,022 |
| Raw UTF-8 JSON | 3,519,584 bytes |
| Gzip, level 9 | 1,150,999 bytes |
| Brotli, quality 6 | 878,482 bytes |

The episode backfill populated 39,874 known counts across 41,537 releases, leaving 1,663 unknown counts as null. The resulting export contains 10,805 TV answers and 4,067 web answers. Branch validation covered repeated backfills (zero further updates) and re-running the normal importer. The backfill was then applied to main; main and test-branch exports produced identical bytes. The legacy-song fingerprint remained `9587fb69bf916026a9020f6f395cbe2e`.

Read-only validation confirmed that all 125 existing songs resolve to answers included in this series-only catalog.

The frontend exposes a reusable MUI autocomplete component on `/catalog`, linked from home. It starts one dedicated Web Worker only when that page mounts. The worker downloads, validates, parses, indexes and searches the catalog; React receives at most 12 results. It stays alive across route navigation and pins the version on first successful load. Refresh rebuilds the index, potentially reusing the HTTP-cached file. No localStorage, IndexedDB or service worker is used.

Normalization handles case, accents, punctuation and Unicode. One answer appears once regardless of how many aliases match; ambiguous aliases remain distinct answers. Search order is **exact title or alias matches first**, then effective popularity/editorial weight among partial matches, then lexical match quality and deterministic ties. Internal/reordered token matches are considered even if many prefixes match. Minimum query length is two normalized characters; inputs are bounded to 100 characters. A 60 ms debounce and request correlation prevent stale results from replacing newer input. This version does not implement edit-distance typo correction.

`yarn catalog:benchmark` in the frontend runs full-catalog ranking checks and a repeatable Node benchmark. On the developer's Apple Silicon Mac with Node 24.18.0: index build approximately 204 ms; retained JS heap 15.0 MB plus 0.68 MB typed-array buffers; warm search median 4.2 ms, p95 7.4 ms across 170 queries. These are decimal MB and exclude startup peak, UI debounce, message delivery and rendering. They are not phone or browser-memory measurements. Real-phone performance remains to be verified before multiplayer readiness gates depend on the index.
