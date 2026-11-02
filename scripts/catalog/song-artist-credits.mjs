import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Pool, neonConfig } from '@neondatabase/serverless';

const migrationVersion = '005_song_artist_credits';
const root = fileURLToPath(new URL('../../', import.meta.url));

async function existingSongFingerprint(client) {
  const result = await client.query(`
    SELECT md5(COALESCE(jsonb_agg(to_jsonb(s) - 'artist_credit' ORDER BY id)::text, '[]')) AS fingerprint
    FROM public.songs s`);
  return result.rows[0].fingerprint;
}

async function readCreditCounts(client) {
  const result = await client.query(`
    SELECT count(*)::integer AS songs,
           count(artist_credit)::integer AS credited,
           count(*) FILTER (WHERE artist_credit IS NULL)::integer AS uncertain
    FROM public.songs`);
  return result.rows[0];
}

/** Apply the immutable reviewed SQL and its checksum atomically. The table lock
 * keeps the audit identity checks and original-column fingerprint consistent. */
export async function applySongArtistCredits(client, migrationSql) {
  const checksum = createHash('sha256').update(migrationSql).digest('hex');
  await client.query('BEGIN');

  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('animasters-catalog-import'))");
    await client.query('LOCK TABLE public.songs IN SHARE ROW EXCLUSIVE MODE');

    const previous = await client.query('SELECT sha256 FROM catalog.migrations WHERE version = $1', [migrationVersion]);
    if (previous.rows.length) {
      if (previous.rows[0].sha256 !== checksum) throw new Error('Applied artist migration checksum changed.');
      const counts = await readCreditCounts(client);
      await client.query('COMMIT');
      return { alreadyApplied: true, ...counts };
    }

    const before = await existingSongFingerprint(client);
    await client.query(migrationSql);
    const after = await existingSongFingerprint(client);
    if (before !== after) throw new Error('Artist migration changed existing song fields.');

    await client.query('INSERT INTO catalog.migrations (version, sha256) VALUES ($1, $2)', [migrationVersion, checksum]);
    const counts = await readCreditCounts(client);
    await client.query('COMMIT');
    return { alreadyApplied: false, originalFieldsUnchanged: true, ...counts };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const { values: options } = parseArgs({
    options: {
      host: { type: 'string' },
      database: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  });

  if (!options.host || !/^[a-z0-9.-]+\.neon\.tech$/.test(options.host) || options.host.includes('-pooler.')) {
    throw new Error('Provide an explicit direct Neon --host.');
  }
  if (!options.database || !process.env.DB_USERNAME || !process.env.DB_PASSWORD) {
    throw new Error('Provide --database and load database credentials with --env-file=.dev.vars.');
  }

  const url = new URL(`postgresql://${options.host}/${encodeURIComponent(options.database)}`);
  url.username = process.env.DB_USERNAME;
  url.password = process.env.DB_PASSWORD;
  url.searchParams.set('sslmode', 'require');
  neonConfig.webSocketConstructor = globalThis.WebSocket;

  const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 15_000 });
  pool.on('error', () => { process.exitCode = 1; });
  let client;

  try {
    client = await pool.connect();
    if (!options.apply) {
      const result = await client.query('SELECT count(*)::integer AS songs FROM public.songs');
      console.log(JSON.stringify({ host: options.host, database: options.database, apply: false, songs: result.rows[0].songs, plannedCredits: 113, plannedUncertain: 12 }));
      return;
    }

    const migrationSql = await fs.readFile(path.join(root, 'migrations/005_song_artist_credits.sql'), 'utf8');
    const result = await applySongArtistCredits(client, migrationSql);
    console.log(JSON.stringify({ host: options.host, database: options.database, ...result }));
  } finally {
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    // Connection exceptions can contain credentials. Report only a safe summary.
    console.error('Artist migration failed. Check the explicit target, access and reviewed catalog identities. No partial migration was committed.');
    process.exitCode = 1;
  }
}
