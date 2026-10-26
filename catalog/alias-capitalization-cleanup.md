# Capitalization-only alias cleanup — October 26, 2026

Aliases are compared with JavaScript `toLowerCase()`, matching the browser's case handling. This cleanup does not fold accents, punctuation or whitespace and does not merge distinct anime IDs.

## Database and export rules

Within each original `anime_id`, keep the first spelling in JavaScript string sort order. This matches the exporter's existing alias ordering and preserves the spelling the search index encountered first. Archive all other capitalization variants in `catalog.excluded_aliases` with policy `case-insensitive-aliases-v1`, original provenance, the retained spelling in the reason, and a fingerprint of the input alias rows. Active aliases are deleted in the same transaction.

The browser export also deduplicates case variants across merged canonical groups and omits aliases that differ only in capitalization from the display title, which is already searchable. Keep every answer ID, title, priority and release detail unchanged. The existing archive suppression prevents repeat imports from resurrecting removed spellings.

## Results

| Measurement | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Active database alias rows | 258,035 | 247,334 | 10,701 |
| Additional aliases in browser export | 92,093 | 87,022 | 5,071 |
| Raw JSON bytes | 3,659,459 | 3,519,584 | 139,875 (3.82%) |
| Gzip bytes, level 9 | 1,175,667 | 1,150,999 | 24,668 (2.10%) |
| Brotli bytes, quality 6 | 899,786 | 878,482 | 21,304 (2.37%) |

Browser reductions include 1,560 capitalization variants of display titles and 3,511 variants of other aliases. The full database includes releases outside the series export, explaining its larger removal count. Removed database alias text totals 272,016 UTF-8 bytes; this is not reclaimed disk space because the originals remain archived.

The complete `CatalogIndex` objects built from both actual exports compare identically, including normalized terms, retained labels, answer metadata, ranking arrays and typed-array ordering. This establishes unchanged search behavior for arbitrary queries, not just a few samples. The index already deduplicated normalized terms, so retained index memory is unchanged; download/parsing work is reduced.

Previous export: `64caba09d6de67c7e5c178001542251dbd8572b65422d7f3eb039c02a2dbabbd`.

New export: `1c6fcb37341c6d74935feed490f60e02beb90dfcdb457a8249eb8b2a2fdf8ddc`.

## Run

```sh
node --env-file=.dev.vars scripts/catalog/cli.mjs capitalization \
  --host YOUR_DIRECT_BRANCH_HOST.neon.tech --database animasters \
  --out .catalog-cache/case-cleanup-report.json
```

This is a read-only preview. Test on an isolated branch first; append `--apply` to archive and remove the planned rows. Then run the normal `export` command. The existing archive migration is reused unchanged. See [language cleanup](alias-language-cleanup.md) for archive inspection and restoration guidance.


## Applied validation

The cleanup was tested on `catalog-import-2026-10-24`, then applied to main. A full repeat import on the test branch left 247,334 active aliases and zero remaining capitalization duplicates. Main contains the same 247,334 active aliases and 10,701 archived case duplicates. All 125 song mappings remain, with the unchanged legacy-song fingerprint `9587fb69bf916026a9020f6f395cbe2e`.

The regenerated main asset matches the branch export byte-for-byte, and its complete browser index matches the pre-cleanup index. All 28 catalog tests, 28 frontend tests, lint and the frontend production build passed.
