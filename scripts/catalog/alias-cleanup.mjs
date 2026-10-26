import { sha256 } from './plan.mjs';
import { selectAnswers } from './export.mjs';

/** Apply inside the caller's transaction; migration bytes are immutable once recorded. */
export async function ensureAliasLanguageSchema(client, migrationSql) {
  if (!migrationSql?.trim()) throw new Error('Missing alias-language migration');
  const version = '004_alias_language_archive';
  const hash = sha256(migrationSql);
  const { rows } = await client.query('SELECT sha256 FROM catalog.migrations WHERE version=$1', [
    version,
  ]);
  if (rows.length) {
    if (rows[0].sha256 !== hash)
      throw new Error('Applied alias-language migration checksum changed');
    return;
  }
  await client.query(migrationSql);
  await client.query('INSERT INTO catalog.migrations(version,sha256) VALUES ($1,$2)', [
    version,
    hash,
  ]);
}

/** One consistent, read-only snapshot supports both classification and exact export sizing. */
export async function readAliasCatalog(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const { rows: aliases } = await client.query(
      'SELECT anime_id, alias, provenance FROM catalog.aliases ORDER BY anime_id, alias COLLATE "C"',
    );
    const { rows: releases } = await client.query(
      'SELECT anime_id, source_urls FROM catalog.releases ORDER BY id',
    );
    const { rows: anime } = await client.query('SELECT id, title FROM catalog.anime ORDER BY id');
    const { rows: identities } = await client.query(
      'SELECT original_id, canonical_id FROM catalog.answer_identity ORDER BY original_id',
    );
    const answers = await selectAnswers(client);
    await client.query('COMMIT');
    return { aliases, releases, anime, identities, answers };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** Remove only the planned rows, with their full originals archived in the same transaction. */
export async function applyAliasCleanup(client, { plan, source, migrationSql }) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('animasters-catalog-import'))");
    await ensureAliasLanguageSchema(client, migrationSql);

    let removed = 0;
    for (let offset = 0; offset < plan.excluded.length; offset += 2000) {
      const batch = plan.excluded.slice(offset, offset + 2000);
      const records = JSON.stringify(batch);
      const archived = await client.query(
        `
        INSERT INTO catalog.excluded_aliases
          (anime_id, alias, provenance, languages, reason, policy, source_sha256)
        SELECT active.anime_id, active.alias, active.provenance,
          input.languages, input.reason, $2, $3
        FROM jsonb_to_recordset($1::jsonb) AS input
          (anime_id integer, alias text, provenance text, languages text[], reason text)
        JOIN catalog.aliases AS active
          ON active.anime_id = input.anime_id AND active.alias = input.alias
          AND active.provenance = input.provenance
        ON CONFLICT DO NOTHING
      `,
        [records, source.policy, source.sha256],
      );
      if (archived.rowCount !== batch.length) {
        throw new Error(
          'Alias cleanup plan is stale or conflicts with archived rows; nothing committed',
        );
      }

      // Matching the original provenance also protects an alias edited since planning.
      const deleted = await client.query(
        `
        DELETE FROM catalog.aliases AS active
        USING jsonb_to_recordset($1::jsonb) AS input
          (anime_id integer, alias text, provenance text)
        WHERE active.anime_id = input.anime_id AND active.alias = input.alias
          AND active.provenance = input.provenance
      `,
        [records],
      );
      if (deleted.rowCount !== batch.length)
        throw new Error('Alias cleanup changed during deletion');
      removed += deleted.rowCount;
    }

    await client.query('COMMIT');
    return { removedActiveAliases: removed, archivedAliases: removed, policy: source.policy };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
