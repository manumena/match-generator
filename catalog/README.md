# Anime catalog

The MVP uses Manami's archived `2026-27` snapshot (July 4, 2026), pinned by URL, SHA-256 and entry count in `snapshot.json`. The full 62 MB source file is downloaded separately and is not committed. No runtime upstream API is required.

The initial import is applied to live Neon. See [import verification](import-verification.md) for branch validation, record counts and API checks. The frontend now has a catalog search page backed by a versioned export. See [search delivery and curation](search-delivery.md) for export commands, editable priorities, duplicate redirects and validation.

## Data and identities

`migrations/001_catalog.sql` adds the `catalog` schema without changing `public.songs` or the existing Worker response:

- `anime`: internal integer answer ID, immutable import key, display title and curation flag.
- `releases`: original provider identities, season titles, relationships and picture/thumbnail URLs. Multiple releases may point to one answer. Migration `003_release_episodes.sql` adds episode counts; see the delivery guide for the one-time backfill of existing releases.
- `aliases`: active imported titles/synonyms plus our aliases; the same string may refer to multiple answers. Never use an alias as an identity.
- `song_anime`: foreign keys joining each existing song to exactly one answer. This separate table avoids adding fields to the deployed `SELECT * FROM songs` API.
- `artwork`: one representative release per answer, constrained to belong to that answer.
- `imports` and `migrations`: source, mapping and schema checksums, attribution and timestamps.

Integer IDs remain stable across repeat imports. They are assigned by the database and must not be recalculated from array positions or compared between independent databases. Provider URLs are import reconciliation keys, not client guess IDs. A browser submits `anime.id`; multiplayer will compare it with the private song mapping.

The initial plan has 41,537 releases, 41,451 answer groups, 284,576 distinct answer/alias pairs and 41,451 representative artwork references. All 125 existing songs across 67 legacy anime labels are mapped. These observed song counts replace the earlier estimate of 143.

## Alias languages

Search targets English, Spanish and Japanese (including romaji). Identified unsupported-language aliases are removed from `aliases` and preserved in `excluded_aliases`; uncertain names remain. See [language cleanup and measured savings](alias-language-cleanup.md) for the policy, recovery and commands.

Capitalization-only duplicates are also removed within each anime, with the original search spelling preserved. See [case cleanup and savings](alias-capitalization-cleanup.md).

## Season curation

`season-mappings.json` is the reviewed input; [season-mappings.md](season-mappings.md) renders its current groups for inspection. It explicitly groups 153 releases into 67 answers associated with current songs. Every other source release retains a separate answer ID. The browser export selects answers containing TV releases or ONA (web) releases with multiple known episodes, including series with no songs; other formats remain stored but are not offered as guesses. We have **not** curated season grouping across the entire upstream catalog.

Regular seasons listed in a group share its answer ID. Naruto/Shippuden, Dragon Ball Z/GT/Super, FMA/Brotherhood, and Digimon Adventure/02/Tamers remain distinct. Remakes, films and spin-offs stay separate unless explicitly listed. Related-anime links are retained as evidence, never used to automatically merge identities. Current Hunter x Hunter songs map to the 2011 adaptation; Yu-Gi-Oh maps to Duel Monsters. JoJo's later parts, Pokémon's later series, Tokyo Ghoul :re and Steins;Gate 0 remain separate for now; these boundaries can be reviewed before adding songs from those releases.

The song backfill identifies the accepted answer, not an invented exact release for each song. Existing song display metadata is preserved. New playable anime must receive an explicit legacy-label mapping; an unknown label aborts the import.

After an import has been applied, **do not edit its mapping file or migration in place and rerun it**. Checksums reject a changed import identity. Further curation requires a versioned, reviewed migration that preserves existing integer IDs, aliases and song references. Incrementing the input version alone does not authorize reassignment: conflicting existing mappings are rejected. Local edits to existing catalog rows are not overwritten on repeat imports.

## Run

Use the repository's Node 24 version and installed dependencies. Download and validate without database access:

```sh
npm run catalog -- download --out .catalog-cache/manami-2026-27.json
npm run catalog -- plan --file .catalog-cache/manami-2026-27.json
npm run test:catalog
```

An optional `--songs path.json` validates a local array of `{ "id": 1, "anime": "Naruto" }` against the mappings. An offline plan without songs reports zero mapped songs.

Database imports require an explicit **direct** Neon host and database. First use an isolated Neon branch. Existing `.dev.vars` supplies only the username/password; the command-line host selects the destination. This does not rewrite `.dev.vars`.

```sh
node --env-file=.dev.vars scripts/catalog/cli.mjs import \
  --file .catalog-cache/manami-2026-27.json \
  --host YOUR_DIRECT_BRANCH_HOST.neon.tech --database animasters
```

This is a read-only dry run. Append `--apply` to run the migration and inserts in one transaction. The importer validates the snapshot and all mappings before connecting, serializes imports with an advisory lock, checks existing mappings, and verifies an unchanged fingerprint of every legacy song column before commit. An error rolls back schema and data together. Repeating identical inputs inserts no duplicate records and retains answer IDs. Sequence counters can advance on conflicting inserts; IDs are not gapless.

There are no deletes or updates to legacy songs. This importer is an administrative script, not a public HTTP endpoint or part of the Worker bundle. Autocomplete exports and browser search are described in the delivery guide; do not send song mappings or unrevealed answer artwork to the browser.

## Attribution and images

Contains information from [anime-offline-database by manami-project](https://github.com/manami-project/anime-offline-database), made available under ODbL 1.0 and DbCL 1.0. The pinned upstream license is included in [LICENSE.manami](LICENSE.manami). Preserve this attribution and the database license with distributed catalog exports; the repository's MIT software license does not replace the dataset license.

Only source image **URLs** are stored. Image ownership and hosting permissions are separate from the database license. Images are not downloaded or mirrored by this import, URL availability is not guaranteed, and the UI must provide a fallback. Keep artwork out of the compact search catalog and keep current-song artwork private until reveal.
