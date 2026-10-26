import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { sha256 } from './plan.mjs';
import { uniqueCaseAliases } from './alias-case.mjs';

const SCHEMA_VERSION = 4;
const CATALOG_SCOPE = 'series';
const SERIES_FORMATS = ['TV', 'ONA'];
const MAX_ASSET_BYTES = 20 * 1024 * 1024;

// Resolve eligibility across every release in an answer group, not just its
// artwork representative. A mixed group can still contain an eligible series.
// This query never joins songs, so having a playable track cannot affect search.
const ANSWERS_QUERY = `
  WITH eligible_releases AS (
    SELECT identity.canonical_id, release.*
    FROM catalog.releases AS release
    JOIN catalog.answer_identity AS identity
      ON identity.original_id = release.anime_id
    WHERE release.format = 'TV'
       OR (release.format = 'ONA' AND release.episodes > 1)
  ), representatives AS (
    SELECT DISTINCT ON (release.canonical_id)
      release.canonical_id,
      release.format,
      release.release_year,
      release.episodes
    FROM eligible_releases AS release
    LEFT JOIN catalog.artwork AS artwork
      ON artwork.anime_id = release.canonical_id
    ORDER BY
      release.canonical_id,
      (release.id = artwork.representative_release_id) DESC NULLS LAST,
      (release.format = 'TV') DESC,
      release.release_year NULLS LAST,
      release.id
  ), names AS (
    SELECT identity.canonical_id, alias.alias
    FROM catalog.answer_identity AS identity
    JOIN catalog.aliases AS alias ON alias.anime_id = identity.original_id
    UNION
    SELECT identity.canonical_id, anime.title
    FROM catalog.answer_identity AS identity
    JOIN catalog.anime AS anime ON anime.id = identity.original_id
  )
  SELECT
    anime.id,
    COALESCE(metadata.display_title, anime.title) AS title,
    COALESCE(metadata.search_priority, metadata.popularity, 0)::integer AS priority,
    representative.format,
    representative.release_year AS year,
    representative.episodes,
    COALESCE(
      jsonb_agg(names.alias ORDER BY names.alias COLLATE "C")
        FILTER (WHERE names.alias IS NOT NULL),
      '[]'::jsonb
    ) AS aliases
  FROM catalog.anime AS anime
  JOIN representatives AS representative ON representative.canonical_id = anime.id
  LEFT JOIN catalog.search_metadata AS metadata ON metadata.anime_id = anime.id
  LEFT JOIN names ON names.canonical_id = anime.id
  GROUP BY
    anime.id, metadata.display_title, metadata.search_priority,
    metadata.popularity, representative.format, representative.release_year, representative.episodes
  ORDER BY anime.id
`;

/** Read one consistent catalog snapshot without modifying Neon. */
export async function readAnswers(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const rows = await selectAnswers(client);
    await client.query('COMMIT');
    return rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** Compose catalog selection into a larger caller-owned snapshot when auditing. */
export async function selectAnswers(client) {
  const { rows: chains } = await client.query(`
      SELECT count(*)::integer AS count
      FROM catalog.answer_redirects AS source
      JOIN catalog.answer_redirects AS target ON source.canonical_id = target.anime_id
    `);
  if (chains[0].count) throw new Error('Chained redirects require review before export');

  const { rows } = await client.query(ANSWERS_QUERY);
  return rows;
}

function validateAnswer(row, previousId) {
  const { id, title, aliases, priority = 0, format, year = null, episodes = null } = row;
  const validId = Number.isSafeInteger(id) && id > previousId;
  const validTitle = typeof title === 'string' && title.trim().length > 0;
  const validAliases =
    Array.isArray(aliases) &&
    aliases.every((alias) => typeof alias === 'string' && alias.trim().length > 0);
  const validPriority = Number.isInteger(priority) && priority >= 0 && priority <= 100;
  const validEpisodes =
    (episodes === null || (Number.isSafeInteger(episodes) && episodes > 0)) &&
    (format !== 'ONA' || (episodes !== null && episodes > 1));
  const validRelease = SERIES_FORMATS.includes(format) && (year === null || Number.isInteger(year));

  // Fail closed if a caller bypasses the SQL filter with an ineligible format.
  if (
    !validId ||
    !validTitle ||
    !validAliases ||
    !validPriority ||
    !validRelease ||
    !validEpisodes
  ) {
    throw new Error('Invalid answer rows; expected unique increasing IDs and TV/web series');
  }
}

/** Encode deterministically: identical answers produce identical bytes and URLs. */
export function encodeCatalog(rows, snapshot) {
  if (!rows.length) throw new Error('Cannot publish an empty catalog');

  let previousId = 0;
  let aliasCount = 0;
  const entries = rows.map((row) => {
    validateAnswer(row, previousId);
    const { id, title, aliases, priority = 0, format, year = null, episodes = null } = row;
    previousId = id;

    // Match the browser's case-insensitive lookup while retaining its first spelling.
    const uniqueAliases = uniqueCaseAliases(title, aliases);
    aliasCount += uniqueAliases.length;
    return [id, title, uniqueAliases, priority, [format, year, episodes]];
  });

  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      scope: CATALOG_SCOPE,
      entries,
    }),
  );
  if (bytes.length > MAX_ASSET_BYTES)
    throw new Error('Catalog exceeds the 20 MiB browser asset budget');

  const version = sha256(bytes);
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    scope: CATALOG_SCOPE,
    version,
    url: `/catalog/anime.${version}.json`,
    bytes: bytes.length,
    entries: entries.length,
    aliases: aliasCount,
    source: {
      name: 'manami-project/anime-offline-database',
      snapshot: snapshot.version,
      url: snapshot.url,
    },
    attribution: snapshot.attribution,
    license: snapshot.license,
    licenseUrl: '/catalog/LICENSE.txt',
  };
  return { bytes, manifest };
}

async function writeImmutable(file, bytes) {
  try {
    await fs.writeFile(file, bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;

    // Re-exporting is safe, but changing an existing hash URL breaks cached clients.
    if (!(await fs.readFile(file)).equals(bytes)) {
      throw new Error('Immutable catalog asset already exists with different bytes', {
        cause: error,
      });
    }
  }
}

export async function writeCatalog(directory, catalog, licenseBytes) {
  await fs.mkdir(directory, { recursive: true });

  // Publish immutable content first. Retain old versions for pinned clients.
  await writeImmutable(path.join(directory, path.basename(catalog.manifest.url)), catalog.bytes);
  const manifestBytes = Buffer.from(JSON.stringify(catalog.manifest, null, 2) + '\n');
  await writeImmutable(
    path.join(directory, `manifest.${catalog.manifest.version}.json`),
    manifestBytes,
  );
  await fs.writeFile(path.join(directory, 'LICENSE.txt'), licenseBytes);

  // Only point new clients at the version after every required file exists.
  const temporaryManifest = path.join(directory, `.manifest-${process.pid}.tmp`);
  await fs.writeFile(temporaryManifest, manifestBytes);
  await fs.rename(temporaryManifest, path.join(directory, 'manifest.json'));

  // These measurements describe compression potential; Pages negotiates actual HTTP encoding.
  return {
    version: catalog.manifest.version,
    scope: catalog.manifest.scope,
    entries: catalog.manifest.entries,
    aliases: catalog.manifest.aliases,
    rawBytes: catalog.bytes.length,
    gzipBytes: gzipSync(catalog.bytes, { level: 9 }).length,
    brotliBytes: brotliCompressSync(catalog.bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
    }).length,
  };
}
