# Initial import verification — October 24, 2026

Import: `manami-2026-27-mappings-1`. Source and mapping inputs are recorded in `snapshot.json`, `season-mappings.json` and `catalog.imports`.

Validated first on Neon branch `catalog-import-2026-10-24` (`br-plain-frog-a53a89i5`), created from `main` in project `falling-union-35884665`. The temporary branch expires October 31, 2026 at 15:08:12 UTC. Applied the same transaction to `main` (`br-falling-night-a5t9gl9m`), database `animasters`, after the branch checks passed. No Worker/frontend deployment was needed.

| Check | Result |
| --- | --- |
| Releases / answer groups | 41,537 / 41,451 |
| Answer/alias pairs | 284,576 |
| Representative artwork references | 41,451 |
| Curated groups / explicitly grouped releases | 67 / 153 |
| Existing songs mapped | 125 of 125, across 67 labels |
| Repeated import on test branch | Same counts and answer IDs; no duplicates |
| Legacy song data | Every column unchanged on test branch and main |
| Main catalog table/index storage | 91,824,128 bytes immediately after import |
| Live `/generate-match?amount=2…` | Two distinct anime; original six-field song response preserved |
| Catalog tests | 6 passed: identity/grouping, no-song choices, unknown labels, source/mapping conflicts, rollback |
| Worker regression tests | 30 passed |
| Lint / type checking / production dry-run build | Passed |

Answer ID fingerprint (`md5` of stable-key/ID pairs ordered by stable key): `2920a2b2daf2f91bce0203b29868361d`, unchanged after repeating the test-branch import and matching main's initial import. This is verification evidence, not a promise that independently initialized databases always assign the same IDs.

Legacy song fingerprint (`md5` of all song rows serialized as JSONB in ID order): `9587fb69bf916026a9020f6f395cbe2e`, identical before and after each import. Example checks on main: Naruto ID 42 and Shippuden ID 43 remain distinct; My Hero Academia ID 5 includes eight explicitly mapped releases. Applications must obtain IDs from the catalog rather than hard-code these examples.

All changes are additive under the `catalog` schema. The importer contains no legacy-song update/delete operation. No room logic, frontend autocomplete, catalog export endpoint, or image mirroring has been introduced. Broader catalog season curation remains incremental; current mappings cover the existing song set.
