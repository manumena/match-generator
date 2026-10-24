import { sha256 } from './plan.mjs';

const definitions = {
  anime: `INSERT INTO catalog.anime (stable_key,title,curated)
    SELECT stable_key,title,curated FROM jsonb_to_recordset($1::jsonb)
      AS x(stable_key text,title text,curated boolean)
    ON CONFLICT (stable_key) DO NOTHING`,
  releases: `INSERT INTO catalog.releases
    (stable_key,anime_id,import_id,title,format,release_year,source_urls,related_urls,picture_url,thumbnail_url)
    SELECT x.stable_key,a.id,$2,x.title,x.format,x.release_year,x.source_urls,x.related_urls,x.picture_url,x.thumbnail_url
    FROM jsonb_to_recordset($1::jsonb) AS x(stable_key text,anime_key text,title text,format text,
      release_year integer,source_urls text[],related_urls text[],picture_url text,thumbnail_url text)
    JOIN catalog.anime a ON a.stable_key=x.anime_key
    ON CONFLICT (stable_key) DO NOTHING`,
  aliases: `INSERT INTO catalog.aliases (anime_id,alias,provenance)
    SELECT a.id,x.alias,x.provenance FROM jsonb_to_recordset($1::jsonb)
      AS x(anime_key text,alias text,provenance text)
    JOIN catalog.anime a ON a.stable_key=x.anime_key
    ON CONFLICT (anime_id,alias) DO NOTHING`,
  artwork: `INSERT INTO catalog.artwork (anime_id,representative_release_id)
    SELECT a.id,r.id FROM jsonb_to_recordset($1::jsonb) AS x(anime_key text,release_key text)
    JOIN catalog.anime a ON a.stable_key=x.anime_key
    JOIN catalog.releases r ON r.stable_key=x.release_key AND r.anime_id=a.id
    ON CONFLICT (anime_id) DO NOTHING`,
  songs: `INSERT INTO catalog.song_anime (song_id,anime_id,legacy_anime,import_id)
    SELECT x.song_id,a.id,x.legacy_anime,$2 FROM jsonb_to_recordset($1::jsonb)
      AS x(song_id integer,anime_key text,legacy_anime text)
    JOIN catalog.anime a ON a.stable_key=x.anime_key
    JOIN public.songs s ON s.id=x.song_id AND s.anime=x.legacy_anime
    ON CONFLICT (song_id) DO NOTHING`,
};

export async function legacyFingerprint(client) {
  const { rows } = await client.query(`SELECT count(*)::integer AS count,
    md5(COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id)::text,'[]')) AS fingerprint FROM public.songs s`);
  return rows[0];
}

export async function applyImport(client, { plan, snapshot, mappingBytes, migrationSql, songsBefore, log = () => {} }) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('animasters-catalog-import'))");
    await client.query(migrationSql);
    const migrationHash = sha256(migrationSql);
    const previous = await client.query('SELECT sha256 FROM catalog.migrations WHERE version=$1', ['001_catalog']);
    if (previous.rows.length && previous.rows[0].sha256 !== migrationHash) throw new Error('Applied migration checksum changed');
    await client.query('INSERT INTO catalog.migrations(version,sha256) VALUES ($1,$2) ON CONFLICT DO NOTHING', ['001_catalog', migrationHash]);
    const existing = await client.query('SELECT source_sha256,mappings_sha256 FROM catalog.imports WHERE id=$1', [plan.importId]);
    const mappingHash = sha256(mappingBytes);
    if (existing.rows.length && (existing.rows[0].source_sha256 !== snapshot.sha256 || existing.rows[0].mappings_sha256 !== mappingHash)) {
      throw new Error('Import identity already exists with different inputs; use a reviewed follow-up migration');
    }
    await client.query(`INSERT INTO catalog.imports(id,source_url,source_sha256,mappings_sha256,source_date,license,attribution)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
    [plan.importId,snapshot.url,snapshot.sha256,mappingHash,snapshot.lastUpdate,snapshot.license,snapshot.attribution]);

    for (const kind of ['anime','releases','aliases','artwork','songs']) {
      const records = plan[kind];
      for (let offset=0;offset<records.length;offset+=2000) {
        const params = [JSON.stringify(records.slice(offset,offset+2000))];
        if (kind === 'releases' || kind === 'songs') params.push(plan.importId);
        await client.query(definitions[kind],params);
      }
      log(`${kind}: ${records.length} records checked/imported`);
    }

    // Refuse accidental reassignments instead of silently overwriting local curation.
    for (const [kind, sql] of [
      ['releases', `SELECT count(*)::integer AS missing FROM jsonb_to_recordset($1::jsonb) AS x(stable_key text,anime_key text)
        LEFT JOIN catalog.releases r ON r.stable_key=x.stable_key
        LEFT JOIN catalog.anime a ON a.id=r.anime_id AND a.stable_key=x.anime_key WHERE a.id IS NULL`],
      ['songs', `SELECT count(*)::integer AS missing FROM jsonb_to_recordset($1::jsonb) AS x(song_id integer,anime_key text,legacy_anime text)
        LEFT JOIN catalog.song_anime s ON s.song_id=x.song_id AND s.legacy_anime=x.legacy_anime
        LEFT JOIN catalog.anime a ON a.id=s.anime_id AND a.stable_key=x.anime_key WHERE a.id IS NULL`],
    ]) {
      const result=await client.query(sql,[JSON.stringify(plan[kind])]);
      if(result.rows[0].missing) throw new Error(`${kind}: missing or conflicting mappings; transaction rolled back`);
    }
    const songsAfter = await legacyFingerprint(client);
    if (JSON.stringify(songsAfter) !== JSON.stringify(songsBefore)) throw new Error('Legacy songs changed during import; retry against a stable snapshot');
    const { rows: unmapped } = await client.query(`SELECT count(*)::integer AS count FROM public.songs s
      LEFT JOIN catalog.song_anime m ON m.song_id=s.id AND m.legacy_anime=s.anime WHERE m.song_id IS NULL`);
    if (unmapped[0].count) throw new Error('Import leaves existing songs unmapped');
    await client.query('COMMIT');
    return { importId: plan.importId, ...plan.summary, legacySongsUnchanged: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
