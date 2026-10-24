import { createHash } from 'node:crypto';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const required = (condition, message) => { if (!condition) throw new Error(message); };

// Only search normalization. Identity is always a curated key or provider URL.
export function normalizeTitle(value) {
  return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
}

function validUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

export function buildPlan(bytes, snapshot, mappings, songs = []) {
  required(sha256(bytes) === snapshot.sha256, 'Snapshot checksum mismatch; refusing unpinned data');
  const source = JSON.parse(bytes.toString('utf8'));
  required(source.lastUpdate === snapshot.lastUpdate, 'Snapshot date mismatch');
  required(Array.isArray(source.data) && source.data.length === snapshot.entries, 'Snapshot entry count mismatch');
  required(mappings.snapshot === snapshot.version && Number.isInteger(mappings.version), 'Invalid mapping version');
  const bySource = new Map();
  const releaseKeys = new Map();
  for (const row of source.data) {
    required(typeof row.title === 'string' && row.title.trim(), 'Missing release title');
    required(Array.isArray(row.sources) && row.sources.length > 0, `Missing source identity: ${row.title}`);
    required(Array.isArray(row.synonyms) && row.synonyms.every(s => typeof s === 'string'), `Invalid synonyms: ${row.title}`);
    required(Array.isArray(row.relatedAnime) && row.relatedAnime.every(validUrl), `Invalid related links: ${row.title}`);
    required(typeof row.type === 'string', `Invalid release format: ${row.title}`);
    required(!row.picture || validUrl(row.picture), `Invalid picture URL: ${row.title}`);
    required(!row.thumbnail || validUrl(row.thumbnail), `Invalid thumbnail URL: ${row.title}`);
    for (const url of row.sources) {
      required(validUrl(url) && !bySource.has(url), `Invalid or duplicate source URL: ${url}`);
      bySource.set(url, row);
    }
    // Stable within the pinned import; use provider cross-references to reconcile future snapshots.
    const preferred = [...row.sources].sort((a, b) => {
      const priority = u => u.startsWith('https://myanimelist.net/anime/') ? 0 : 1;
      return priority(a) - priority(b) || (a < b ? -1 : a > b ? 1 : 0);
    })[0];
    releaseKeys.set(row, preferred);
  }

  const groupByRelease = new Map();
  const legacyGroups = new Map();
  const anime = new Map();
  const artwork = [];
  const aliases = new Map();
  const addAlias = (key, alias, provenance) => {
    const clean = alias.trim();
    if (!clean) return;
    const identity = JSON.stringify([key, clean]);
    if (!aliases.has(identity) || provenance === 'curated') aliases.set(identity, { anime_key: key, alias: clean, provenance });
  };

  for (const group of mappings.groups) {
    required(typeof group.key === 'string' && /^[a-z0-9-]+$/.test(group.key), 'Invalid curated key');
    const key = `curated:${group.key}`;
    required(!anime.has(key) && typeof group.title === 'string' && group.title.trim(), `Invalid or repeated group: ${key}`);
    required(group.members.includes(group.representativeSource), `Representative must belong to ${key}`);
    anime.set(key, { stable_key: key, title: group.title, curated: true });
    for (const url of group.members) {
      const row = bySource.get(url);
      required(row, `Unknown curated member: ${url}`);
      required(!groupByRelease.has(row), `Release assigned more than once: ${url}`);
      groupByRelease.set(row, key);
    }
    for (const label of group.legacyLabels) {
      required(!legacyGroups.has(label), `Repeated legacy label: ${label}`);
      legacyGroups.set(label, key);
      addAlias(key, label, 'curated');
    }
    for (const alias of [group.title, ...group.aliases]) addAlias(key, alias, 'curated');
    artwork.push({ anime_key: key, release_key: releaseKeys.get(bySource.get(group.representativeSource)) });
  }

  const releases = source.data.map(row => {
    const releaseKey = releaseKeys.get(row);
    const key = groupByRelease.get(row) ?? `source:${releaseKey}`;
    if (!anime.has(key)) {
      anime.set(key, { stable_key: key, title: row.title, curated: false });
      artwork.push({ anime_key: key, release_key: releaseKey });
    }
    for (const alias of [row.title, ...row.synonyms]) addAlias(key, alias, 'snapshot');
    return {
      stable_key: releaseKey, anime_key: key, title: row.title, format: row.type,
      release_year: row.animeSeason?.year ?? null, source_urls: row.sources,
      related_urls: row.relatedAnime, picture_url: row.picture || null, thumbnail_url: row.thumbnail || null,
    };
  });
  const songIds = new Set();
  const songMappings = songs.map(song => {
    required(Number.isInteger(song.id) && !songIds.has(song.id), 'Invalid or duplicate song ID');
    songIds.add(song.id);
    const key = legacyGroups.get(song.anime);
    required(key, `Unmapped song anime: ${song.anime}; add an explicit reviewed mapping`);
    return { song_id: song.id, anime_key: key, legacy_anime: song.anime };
  });
  const sortByKey = rows => rows.sort((a, b) => a.stable_key < b.stable_key ? -1 : a.stable_key > b.stable_key ? 1 : 0);
  return {
    importId: `manami-${snapshot.version}-mappings-${mappings.version}`,
    anime: sortByKey([...anime.values()]), releases: sortByKey(releases), aliases: [...aliases.values()], artwork,
    songs: songMappings,
    summary: { sourceReleases: releases.length, answerGroups: anime.size, curatedGroups: mappings.groups.length,
      groupedReleases: groupByRelease.size, aliases: aliases.size, mappedSongs: songMappings.length,
      legacyLabels: legacyGroups.size },
  };
}
