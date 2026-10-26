import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { buildPlan, sha256 } from './plan.mjs';
import { applyImport, legacyFingerprint } from './import.mjs';
import { readAnswers, encodeCatalog, writeCatalog } from './export.mjs';
import { applyEpisodeCounts } from './episodes.mjs';
import { readAliasCatalog, applyAliasCleanup } from './alias-cleanup.mjs';
import { planAliasCaseDuplicates } from './alias-case.mjs';
import {
  readLanguageEvidence,
  planAliasLanguages,
  measureAliasSavings,
} from './alias-languages.mjs';
import { applyCuration, resolveCuration } from './curate.mjs';

// Administrative commands run in Node, outside the deployed Cloudflare Worker.
const root = fileURLToPath(new URL('../../', import.meta.url));
const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: 'string' },
    songs: { type: 'string' },
    host: { type: 'string' },
    database: { type: 'string' },
    out: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});
const snapshot = JSON.parse(await fs.readFile(path.join(root, 'catalog/snapshot.json'), 'utf8'));

// Connection lifecycle is shared, but every command must select its destination
// explicitly. Local credentials never imply that production is the target.
async function withDatabase(operation) {
  if (!options.host || !options.database) {
    throw new Error('Provide --host and --database explicitly; no implicit production target');
  }
  if (!/^[a-z0-9.-]+\.neon\.tech$/.test(options.host) || options.host.includes('-pooler.')) {
    throw new Error('Use a direct Neon host');
  }
  if (!process.env.DB_USERNAME || !process.env.DB_PASSWORD) {
    throw new Error('Load DB_USERNAME and DB_PASSWORD using --env-file=.dev.vars');
  }

  const url = new URL(`postgresql://${options.host}/${encodeURIComponent(options.database)}`);
  url.username = process.env.DB_USERNAME;
  url.password = process.env.DB_PASSWORD;
  url.searchParams.set('sslmode', 'require');
  neonConfig.webSocketConstructor = globalThis.WebSocket;

  const pool = new Pool({
    connectionString: url.toString(),
    max: 1,
    connectionTimeoutMillis: 15000,
  });
  pool.on('error', () => {
    console.error('Database connection failed');
    process.exitCode = 1;
  });

  let client;
  try {
    client = await pool.connect();
    return await operation(client);
  } finally {
    client?.release();
    await pool.end();
  }
}

async function downloadSnapshot() {
  if (!options.out)
    throw new Error('Provide --out for the snapshot file (keep generated data out of Git)');

  const response = await fetch(snapshot.url);
  if (!response.ok) throw new Error(`Snapshot download failed: HTTP ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== snapshot.sha256) throw new Error('Downloaded snapshot checksum mismatch');

  await fs.mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
  await fs.writeFile(options.out, bytes);
  console.log(`Verified snapshot ${snapshot.version}: ${bytes.length} bytes`);
}

async function readImportInputs() {
  if (!options.file) throw new Error('Provide --file with the pinned snapshot');
  const bytes = await fs.readFile(options.file);
  const mappingBytes = await fs.readFile(path.join(root, 'catalog/season-mappings.json'));
  const mappings = JSON.parse(mappingBytes.toString('utf8'));

  // Validate source identity and season mappings before opening any connection.
  buildPlan(bytes, snapshot, mappings);
  return { bytes, mappingBytes, mappings };
}

async function previewImport() {
  const { bytes, mappings } = await readImportInputs();
  const songs = options.songs ? JSON.parse(await fs.readFile(options.songs, 'utf8')) : [];
  const plan = buildPlan(bytes, snapshot, mappings, songs);
  const report = JSON.stringify({ importId: plan.importId, ...plan.summary }, null, 2);

  if (options.out) await fs.writeFile(options.out, report + '\n');
  console.log(report);
}

async function importCatalog() {
  const { bytes, mappingBytes, mappings } = await readImportInputs();
  await withDatabase(async (client) => {
    const songsBefore = await legacyFingerprint(client);
    const { rows: songs } = await client.query('SELECT id,anime FROM public.songs ORDER BY id');
    const plan = buildPlan(bytes, snapshot, mappings, songs);

    console.log(
      JSON.stringify({
        target: { host: options.host, database: options.database },
        ...plan.summary,
        apply: options.apply,
      }),
    );
    if (!options.apply) return;

    const migrationSql = await fs.readFile(path.join(root, 'migrations/001_catalog.sql'), 'utf8');
    const result = await applyImport(client, {
      plan,
      snapshot,
      mappingBytes,
      migrationSql,
      episodeMigrationSql: await fs.readFile(
        path.join(root, 'migrations/003_release_episodes.sql'),
        'utf8',
      ),
      aliasLanguageMigrationSql: await fs.readFile(
        path.join(root, 'migrations/004_alias_language_archive.sql'),
        'utf8',
      ),
      songsBefore,
      log: console.log,
    });
    console.log(JSON.stringify(result, null, 2));
  });
}

async function curateCatalog() {
  const bytes = await fs.readFile(options.file ?? path.join(root, 'catalog/search-curation.json'));
  const document = JSON.parse(bytes);

  await withDatabase(async (client) => {
    if (!options.apply) {
      const plan = await resolveCuration(client, document);
      console.log(
        JSON.stringify({
          version: document.version,
          editorialPriorities: plan.metadata.length,
          duplicateRedirects: plan.redirects.length,
          apply: false,
        }),
      );
      return;
    }

    const migrationSql = await fs.readFile(
      path.join(root, 'migrations/002_catalog_curation.sql'),
      'utf8',
    );
    const result = await applyCuration(client, { document, bytes, migrationSql });
    console.log(JSON.stringify(result, null, 2));
  });
}

async function backfillEpisodes() {
  const { bytes, mappings } = await readImportInputs();
  const plan = buildPlan(bytes, snapshot, mappings);
  if (!options.apply) {
    console.log(JSON.stringify({ checkedReleases: plan.releases.length, apply: false }));
    return;
  }

  const migrationSql = await fs.readFile(
    path.join(root, 'migrations/003_release_episodes.sql'),
    'utf8',
  );
  const result = await withDatabase((client) =>
    applyEpisodeCounts(client, { plan, snapshot, migrationSql }),
  );
  console.log(JSON.stringify(result, null, 2));
}

async function cleanAliasLanguages() {
  if (!options.file) throw new Error('Provide --file with the pinned AniDB title dump');
  const source = JSON.parse(
    await fs.readFile(path.join(root, 'catalog/alias-language-source.json'), 'utf8'),
  );
  const evidence = readLanguageEvidence(await fs.readFile(options.file), source);
  const reviewBytes = await fs.readFile(
    path.join(root, 'catalog/alias-language-latin-review.json'),
  );
  if (sha256(reviewBytes) !== source.latinReviewSha256)
    throw new Error('Latin alias review checksum mismatch');
  const review = JSON.parse(reviewBytes);
  const latinReview = new Map(review.exclusions.map((row) => [row.alias, row.language]));

  await withDatabase(async (client) => {
    const data = await readAliasCatalog(client);
    const plan = planAliasLanguages(data, evidence, latinReview);
    const report = measureAliasSavings(data, plan, snapshot);
    if (options.out)
      await fs.writeFile(
        options.out,
        JSON.stringify({ source, report, excluded: plan.excluded }, null, 2) + '\n',
      );
    console.log(JSON.stringify(report, null, 2));
    if (!options.apply) return;

    const migrationSql = await fs.readFile(
      path.join(root, 'migrations/004_alias_language_archive.sql'),
      'utf8',
    );
    const result = await applyAliasCleanup(client, { plan, source, migrationSql });
    console.log(JSON.stringify(result, null, 2));
  });
}

async function cleanAliasCapitalization() {
  await withDatabase(async (client) => {
    const data = await readAliasCatalog(client);
    const plan = planAliasCaseDuplicates(data.aliases);
    // The archived rows retain provenance and a fingerprint of the reviewed inputs.
    const source = {
      policy: 'case-insensitive-aliases-v1',
      sha256: sha256(JSON.stringify(data.aliases)),
    };
    const report = {
      before: data.aliases.length,
      removed: plan.excluded.length,
      after: plan.retainedAliasRows,
      policy: source.policy,
    };
    if (options.out)
      await fs.writeFile(
        options.out,
        JSON.stringify({ source, report, excluded: plan.excluded }, null, 2) + '\n',
      );
    console.log(JSON.stringify(report, null, 2));
    if (!options.apply) return;

    const migrationSql = await fs.readFile(
      path.join(root, 'migrations/004_alias_language_archive.sql'),
      'utf8',
    );
    console.log(
      JSON.stringify(await applyAliasCleanup(client, { plan, source, migrationSql }), null, 2),
    );
  });
}

async function exportCatalog() {
  if (!options.out) throw new Error('Provide --out for the catalog asset directory');
  if (options.apply) throw new Error('Export is read-only; --apply is not supported');

  // Release the database connection before compression and filesystem work.
  const rows = await withDatabase(readAnswers);
  const catalog = encodeCatalog(rows, snapshot);
  const license = await fs.readFile(path.join(root, 'catalog/LICENSE.manami'));
  const result = await writeCatalog(path.resolve(options.out), catalog, license);
  console.log(JSON.stringify(result, null, 2));
}

// Keep dispatch separate from command implementation so the entry point is easy to scan.
const commands = {
  download: downloadSnapshot,
  plan: previewImport,
  import: importCatalog,
  curate: curateCatalog,
  export: exportCatalog,
  episodes: backfillEpisodes,
  languages: cleanAliasLanguages,
  capitalization: cleanAliasCapitalization,
};

try {
  const run = Object.hasOwn(commands, positionals[0]) ? commands[positionals[0]] : undefined;
  if (!run) {
    throw new Error(
      'Usage: catalog <download|plan|import|export|curate|episodes|languages|capitalization> [--file <input>] [--songs <json>] [--host <direct-host> --database <db>] [--out <path>] [--apply]',
    );
  }
  await run();
} catch (error) {
  // Do not expose connection strings if a driver includes one in an error.
  const message = String(error.message).replace(
    /postgres(?:ql)?:\/\/\S+/g,
    '[redacted connection]',
  );
  console.error(message);
  process.exitCode = 1;
}
