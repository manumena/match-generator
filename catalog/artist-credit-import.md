# Artist display credits

The owner selected a nullable `artist_credit text` column on `public.songs`. It stores the complete performer display credit, including featured singers; no separate artist table is needed for this reveal feature.

`005_song_artist_credits.sql` contains the reviewed 125-song identity set, 113 credits and twelve NULLs from [the coverage audit](artist-coverage-audit.md). The [manual-review checklist](artist-credit-manual-review.md) records the unresolved identities. Evidence and review decisions remain in versioned audit files rather than being exposed by the game API.

## Apply

Test on an isolated Neon branch first. Use a direct host and the existing credentials without replacing `.dev.vars` or redirecting the app to the test branch.

```sh
node --env-file=.dev.vars scripts/catalog/song-artist-credits.mjs \
  --host YOUR_DIRECT_BRANCH_HOST.neon.tech --database animasters
```

This is a read-only preview of the target and planned counts. Append `--apply` to run the SQL and register its checksum in `catalog.migrations` in one transaction. The script:

- Locks the song table briefly and rejects stale IDs/anime names/song titles or a changed 125-song identity set.
- Adds a nullable, trimmed, nonempty text column without inventing default credits.
- Rejects conflicting existing credits; never overwrites subsequent editorial work.
- Applies the 113 reviewed values and verifies the 12 uncertain entries remain NULL.
- Compares every other existing song field before and after. A failure rolls back the entire migration.
- Treats a repeated identical migration as a no-op and rejects an edited applied migration.

Use a new migration when manual review resolves another recording. Do not edit an applied migration or regenerate its reviewed batch from changing online sources.

## API and reveal

- `GET /generate-match` explicitly selects its original six fields: `id`, `anime`, `name`, `type`, `number`, `path`. Its response remains compatible, and future schema additions do not automatically enter the legacy payload.
- Multiplayer reads `artist_credit` with the selected songs and stores it privately as optional `artistCredit`.
- A revealed result includes `artistCredit` only when known. The current/future round projection and private-submission acknowledgements do not publish it.
- Persisted rooms prepared before this change have no credit and remain playable. New matches read the enriched column.
- The reveal shows the artist below the song title, before the opening/ending metadata. Unknown credits have no placeholder row.

Apply the database migration before deploying the updated Worker query. Application deployment is separate from this migration.

## November 2 verification

Applied successfully to an isolated Neon branch, then to the configured `animasters` database. Both returned 125 songs, 113 credits, 12 NULLs and an unchanged fingerprint for every preexisting song field.

Branch checks rejected stale titles, conflicting existing artist credits and modified migration checksums. Reapplying identical SQL was a no-op. A read-only comparison of every configured-database credit against the audit passed. The updated multiplayer query returned the credits; the isolated local `GET /generate-match` smoke test returned exactly the original six fields. Backend and frontend tests, lint, type checks and builds passed. No application deployment was performed.

The validation branch compute was suspended after use, and the branch expires automatically after one day. Local app credentials were not changed.
