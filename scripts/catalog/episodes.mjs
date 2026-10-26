import { sha256 } from './plan.mjs';

/** Called inside the import/backfill transaction; never edit an applied migration. */
export async function ensureEpisodeSchema(client, migrationSql) {
  if (!migrationSql?.trim()) throw new Error('Missing episode-count migration');
  const version = '003_release_episodes';
  const hash = sha256(migrationSql);
  const { rows } = await client.query('SELECT sha256 FROM catalog.migrations WHERE version=$1', [
    version,
  ]);

  if (rows.length) {
    if (rows[0].sha256 !== hash) throw new Error('Applied episode migration checksum changed');
    return;
  }

  await client.query(migrationSql);
  await client.query('INSERT INTO catalog.migrations(version,sha256) VALUES ($1,$2)', [
    version,
    hash,
  ]);
}

/** Enrich an existing pinned import without changing identities or editorial counts. */
export async function applyEpisodeCounts(client, { plan, snapshot, migrationSql }) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('animasters-catalog-import'))");

    // Refuse a backfill from another source revision or an incomplete import.
    const { rows: imports } = await client.query(
      'SELECT source_sha256 FROM catalog.imports WHERE id=$1',
      [plan.importId],
    );
    if (imports[0]?.source_sha256 !== snapshot.sha256) {
      throw new Error('Episode backfill requires the matching pinned import');
    }
    const records = plan.releases.map(({ stable_key, episodes }) => ({ stable_key, episodes }));
    const { rows: missing } = await client.query(
      `
      SELECT count(*)::integer AS count
      FROM jsonb_to_recordset($1::jsonb) AS input(stable_key text)
      LEFT JOIN catalog.releases AS release
        ON release.stable_key = input.stable_key AND release.import_id = $2
      WHERE release.id IS NULL
    `,
      [JSON.stringify(records), plan.importId],
    );
    if (missing[0].count) throw new Error('Episode backfill has missing or mismatched releases');

    await ensureEpisodeSchema(client, migrationSql);
    let updated = 0;
    for (let offset = 0; offset < records.length; offset += 2000) {
      // Known counts already in Neon may have been curated; never overwrite them.
      const result = await client.query(
        `
        UPDATE catalog.releases AS release
        SET episodes = input.episodes
        FROM jsonb_to_recordset($1::jsonb) AS input(stable_key text, episodes integer)
        WHERE release.stable_key = input.stable_key AND release.import_id = $2
          AND release.episodes IS NULL AND input.episodes IS NOT NULL
      `,
        [JSON.stringify(records.slice(offset, offset + 2000)), plan.importId],
      );
      updated += result.rowCount;
    }

    await client.query('COMMIT');
    return {
      importId: plan.importId,
      checkedReleases: records.length,
      updatedEpisodeCounts: updated,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
