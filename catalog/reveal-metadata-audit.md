# Reveal song metadata audit

Audited November 2, 2026 with read-only queries against the database configured for this repository. No song records were changed.

| Stored type | Songs | Type and number shown | Type only |
| --- | ---: | ---: | ---: |
| Opening | 114 | 68 | 46 |
| Ending | 11 | 8 | 3 |
| Soundtrack | 0 | 0 | 0 |
| Total | 125 | 76 | 49 |

All 125 stored numbers were positive integers. Presence alone does not establish reliability: legacy numbering mixes seasons/series and does not identify each song's exact release. For example, Naruto Shippuden songs 107 (`Kaze`) and 116 (`Toumei datta Sekai`) both claim opening 17.

## Display policy

- Pass through only known types: opening, ending, soundtrack.
- Include a sequence number only for an opening/ending with a positive safe integer, exactly one catalog release attached to its answer, and exactly one song occupying that answer/type/number slot.
- Calculate release and slot counts over the full eligible database query before random selection. Missing counts fail closed.
- Omit numbers for multi-release answers until song-to-release mappings or reviewed metadata establish an unambiguous numbering convention. This intentionally hides some potentially correct values.
- Do not number soundtracks: the legacy number is not established as an OP/ED sequence.
- This is an internal consistency audit, not independent verification of every song's historical sequence. No numbers are corrected or guessed.

The result fields are optional `songType` and `sequenceNumber`. `result.number` remains the song's position in the match. Metadata stays private until reveal, like title and artwork. Existing persisted rooms without these fields continue working. No migration is required.

## Read-only audit query

```sql
WITH metadata AS (
  SELECT s.id, s.anime, s.name, s.type::text AS type, s.number,
         (SELECT count(*)::integer FROM catalog.releases r
          WHERE r.anime_id = a.anime_id) AS release_count,
         count(*) OVER (
           PARTITION BY a.anime_id, s.type, s.number
         )::integer AS sequence_count
  FROM public.songs s
  JOIN catalog.song_answers a ON a.song_id = s.id
)
SELECT type, count(*)::integer AS songs,
       count(*) FILTER (
         WHERE release_count = 1 AND sequence_count = 1 AND number > 0
       )::integer AS numbered,
       count(*) FILTER (WHERE release_count <> 1)::integer AS ambiguous_release,
       count(*) FILTER (WHERE sequence_count > 1)::integer AS conflicting_sequence
FROM metadata
GROUP BY type
ORDER BY type;
```
