import { sha256 } from './plan.mjs';
import { legacyFingerprint } from './import.mjs';

/** Resolve reviewed provider URLs to existing IDs; this step never writes data. */
export async function resolveCuration(client, document) {
  if (
    !/^[a-z0-9-]+$/.test(document.version) ||
    !Array.isArray(document.metadata) ||
    !Array.isArray(document.redirects)
  ) {
    throw new Error('Invalid curation document');
  }

  // Resolve all references together and reject missing or ambiguous identities.
  const sources = [
    ...new Set([
      ...document.metadata.map((row) => row.source),
      ...document.redirects.flatMap((row) => [row.source, row.target]),
    ]),
  ];
  const { rows } = await client.query(
    `SELECT x.source, r.anime_id AS id
    FROM unnest($1::text[]) AS x(source) JOIN catalog.releases r ON x.source = ANY(r.source_urls)`,
    [sources],
  );
  const ids = new Map(rows.map((row) => [row.source, row.id]));
  if (rows.length !== sources.length || ids.size !== sources.length)
    throw new Error('Curation source missing or ambiguous');

  // Editorial weights and redirects have separate validation rules.
  const metadata = document.metadata.map((row) => {
    if (
      !Number.isInteger(row.priority) ||
      row.priority < 0 ||
      row.priority > 100 ||
      !row.reason?.trim() ||
      (row.title !== undefined && !row.title.trim())
    )
      throw new Error('Invalid editorial priority or title');
    return {
      anime_id: ids.get(row.source),
      display_title: row.title ?? null,
      search_priority: row.priority,
      reason: row.reason,
    };
  });
  const redirects = document.redirects.map((row) => {
    if (!row.reason?.trim()) throw new Error('Missing duplicate review reason');
    return { anime_id: ids.get(row.source), canonical_id: ids.get(row.target), reason: row.reason };
  });
  if (new Set(metadata.map((row) => row.anime_id)).size !== metadata.length)
    throw new Error('Repeated metadata answer');

  // One-hop redirects simplify both export and future server-side answer checks.
  const redirectIds = new Set(redirects.map((row) => row.anime_id));
  if (
    redirectIds.size !== redirects.length ||
    redirects.some((row) => redirectIds.has(row.canonical_id))
  ) {
    throw new Error('Redirects must be unique, direct and acyclic');
  }
  return { metadata, redirects };
}

/** Apply one reviewed revision atomically, preserving the original song records. */
export async function applyCuration(client, { document, bytes, migrationSql }) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('animasters-catalog-import'))");
    const before = await legacyFingerprint(client);
    const plan = await resolveCuration(client, document);

    // Applied schema and seed files are immutable; edits need a new revision.
    await client.query(migrationSql);
    const migrationHash = sha256(migrationSql);
    const { rows: migrations } = await client.query(
      'SELECT sha256 FROM catalog.migrations WHERE version=$1',
      ['002_catalog_curation'],
    );
    if (migrations.length && migrations[0].sha256 !== migrationHash)
      throw new Error('Applied curation migration changed');
    await client.query(
      'INSERT INTO catalog.migrations(version,sha256) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      ['002_catalog_curation', migrationHash],
    );
    const hash = sha256(bytes);
    const { rows: revisions } = await client.query(
      'SELECT sha256 FROM catalog.curation_revisions WHERE version=$1',
      [document.version],
    );
    if (revisions.length && revisions[0].sha256 !== hash)
      throw new Error('Applied curation inputs changed; use a reviewed follow-up revision');

    // Insert-only seeds leave later manual metadata edits intact.
    await client.query(
      `INSERT INTO catalog.search_metadata(anime_id,display_title,search_priority,reason)
      SELECT anime_id,display_title,search_priority,reason FROM jsonb_to_recordset($1::jsonb)
      AS x(anime_id integer,display_title text,search_priority smallint,reason text) ON CONFLICT DO NOTHING`,
      [JSON.stringify(plan.metadata)],
    );
    await client.query(
      `INSERT INTO catalog.answer_redirects(anime_id,canonical_id,reason)
      SELECT anime_id,canonical_id,reason FROM jsonb_to_recordset($1::jsonb)
      AS x(anime_id integer,canonical_id integer,reason text) ON CONFLICT DO NOTHING`,
      [JSON.stringify(plan.redirects)],
    );

    // Check the combined database state too: an existing redirect may conflict
    // with a locally valid plan or introduce a chain.
    const { rows: conflicts } = await client.query(
      `SELECT count(*)::integer AS count
      FROM jsonb_to_recordset($1::jsonb) AS x(anime_id integer,canonical_id integer)
      LEFT JOIN catalog.answer_redirects r USING(anime_id) WHERE r.canonical_id IS DISTINCT FROM x.canonical_id`,
      [JSON.stringify(plan.redirects)],
    );
    const { rows: chains } = await client.query(
      'SELECT count(*)::integer AS count FROM catalog.answer_redirects a JOIN catalog.answer_redirects b ON a.canonical_id=b.anime_id',
    );
    if (conflicts[0].count || chains[0].count)
      throw new Error('Conflicting or chained answer redirects');

    // The catalog layer must not mutate the current game's song payloads.
    if (JSON.stringify(await legacyFingerprint(client)) !== JSON.stringify(before))
      throw new Error('Legacy songs changed');
    await client.query(
      'INSERT INTO catalog.curation_revisions(version,sha256) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [document.version, hash],
    );
    await client.query('COMMIT');
    return {
      version: document.version,
      editorialPriorities: plan.metadata.length,
      duplicateRedirects: plan.redirects.length,
      legacySongsUnchanged: true,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
