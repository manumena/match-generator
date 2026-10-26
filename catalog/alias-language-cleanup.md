# Alias language cleanup — October 25, 2026

The intended search languages are English, Spanish and Japanese, including romaji. The owner accepted a conservative cleanup: substantially reduce unsupported-language aliases while retaining uncertain names. Manami's synonym strings do not include language labels, so this is not a claim that every remaining alias has been language-verified.

## What is removed and retained

The cleanup uses the checksum-pinned [AniDB title dump](https://anidb.net/api/anime-titles.dat.gz) listed in `alias-language-source.json`. Provider IDs link language evidence to the corresponding canonical answer, including its seasons and duplicate redirects.

- Keep English (`en`), Spanish (`es`, `es-419`), Japanese (`ja`) and Japanese transliteration (`x-jat`).
- Keep primary titles, curated aliases, spellings also present in supported-language evidence, and titles containing Japanese kana.
- Remove aliases identified as other languages. For Latin-script aliases, require agreement from the pinned second-opinion list in `alias-language-latin-review.json`; locale tags alone can label English/Spanish wording as another localization.
- The second-opinion list was generated offline with Lingua 2.2.0, requiring agreement with the source language, a score of at least 0.70, a margin of at least 0.25, two words and eight letters. These scores are model heuristics, not a guarantee of correctness. No language detector runs in the app or browser.
- Without language tags, remove titles dominated by clearly unsupported scripts, such as Cyrillic, Hebrew, Arabic, Korean or Thai. Short decorative characters are insufficient. Unclassified Latin and Han-only text stays because it can be English, Spanish, romaji or Japanese.

`אקאמה הרוצחת` and `Убийца Акамэ!` are both removed from the active aliases table for Akame ga Kill.

## Measured changes

All sizes below are bytes. Compression uses gzip level 9 and Brotli quality 6, matching the normal exporter; actual Pages transfer encoding is negotiated by the browser.

| Measurement | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Active database alias rows | 284,576 | 258,035 | 26,541 |
| Additional aliases in the series export | 110,904 | 92,093 | 18,811 |
| Raw browser JSON | 4,310,815 | 3,659,459 | 651,356 (15.11%) |
| Gzip | 1,526,877 | 1,175,667 | 351,210 (23.00%) |
| Brotli | 1,135,152 | 899,786 | 235,366 (20.73%) |

The 14,872 answer IDs and 125 mapped songs remain unchanged. The removed active alias strings contain 873,952 UTF-8 bytes. This is not a database-disk saving: the originals remain archived for recovery, and PostgreSQL deletion does not immediately shrink table files. The primary saving is the browser catalog transfer and index workload.

## Inspect and recover

In Neon, select database `animasters`, schema `catalog`:

- `aliases` contains active aliases used by the exporter.
- `excluded_aliases` contains the originals, provenance, source language tags, removal reason, policy and source checksum. It is not exported to browsers.

Migration `004_alias_language_archive.sql` creates the archive. Archiving and deletion happen together in a transaction; stale or mismatched plans roll back. The importer skips archived `(anime_id, alias)` pairs, preventing a repeat import from restoring them accidentally.

To restore an incorrectly classified alias, use a reviewed transaction to copy that one archived row's `anime_id`, `alias` and `provenance` back into `aliases`, then remove its archive entry. Update the classification inputs before running cleanup again, and regenerate the browser export. Do not bulk-clear the archive.

A local pre-cleanup recovery copy is retained in `.catalog-cache/aliases-before-language-cleanup.json`. Detailed plans and language evidence are also retained in the ignored cache; no credentials are included. The pinned daily AniDB dump is saved as `.catalog-cache/anidb-titles-2026-10-25.dat.gz`; the live download URL changes over time, so preserve this input if repeating the same audit.

## Run

```sh
node --env-file=.dev.vars scripts/catalog/cli.mjs languages \
  --file .catalog-cache/anidb-titles-2026-10-25.dat.gz \
  --host YOUR_DIRECT_BRANCH_HOST.neon.tech --database animasters \
  --out .catalog-cache/language-report.json
```

This is read-only without `--apply`. Test on an isolated branch first, then append `--apply` to archive and remove the planned aliases. Afterwards run the normal `export` command. A new source snapshot requires a newly reviewed language audit; do not silently replace pinned evidence or reuse a policy name for different rules.

Branch validation included the cleanup, a full repeat import (no excluded aliases resurrected), export byte-size verification, and an unchanged legacy-song fingerprint: `9587fb69bf916026a9020f6f395cbe2e`. The production cleanup was applied and its export matches the tested hash `64caba09d6de67c7e5c178001542251dbd8572b65422d7f3eb039c02a2dbabbd`.

Production verification found 258,035 active aliases, 26,541 archived aliases, zero active matches for the two user-reported examples, and the same legacy-song fingerprint. The full-export search checks preserve English, Spanish, Japanese and romaji results and return no results for those two removed examples. All 25 catalog tests, 28 frontend tests, lint and the frontend production build passed. Code and regenerated assets have not yet been committed or pushed.
