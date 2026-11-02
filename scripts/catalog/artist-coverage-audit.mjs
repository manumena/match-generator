import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const cacheDirectory = path.join(repositoryRoot, '.catalog-cache/artist-audit-2026-11-02');

async function exportSongs() {
  const env = process.env;
  if (!env.DB_USERNAME || !env.DB_PASSWORD || !env.DB_HOST) {
    throw new Error('The configured database credentials are required for the read-only export.');
  }

  const sql = neon(`postgresql://${env.DB_USERNAME}:${env.DB_PASSWORD}@${env.DB_HOST}/${env.DATABASE || 'animasters'}?sslmode=require`);
  // Deliberately select only the audit fields. This tool has no database write
  // statements and does not fetch credentials, audio or artwork from providers.
  const songs = await sql(`
    SELECT s.id, s.anime, s.name, s.type::text AS type, s.number, s.path, a.anime_id,
           (SELECT json_agg(json_build_object('id', r.id, 'title', r.title, 'sources', r.source_urls) ORDER BY r.id)
            FROM catalog.releases r WHERE r.anime_id = a.anime_id) AS releases
    FROM public.songs s
    JOIN catalog.song_answers a ON a.song_id = s.id
    ORDER BY s.id`);

  await fs.mkdir(cacheDirectory, { recursive: true });
  await fs.writeFile(path.join(cacheDirectory, 'songs.json'), `${JSON.stringify(songs, null, 2)}\n`);
  console.log(`Exported ${songs.length} songs using SELECT only.`);
}

function decodeEntities(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, name) => {
    if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
    return named[name.toLowerCase()] ?? entity;
  });
}

function plainText(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function normalizeTitle(title) {
  return title.normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\([^)]*\)/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Extract only the published theme-credit cells; ignore scripts, media links,
 * unrelated page text and the anime's aggregate music/staff credits. */
export function parseThemeCredits(html, malId) {
  const cleanHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const sections = [...cleanHtml.matchAll(/<h2[^>]*>\s*(Opening|Ending) Theme\s*<\/h2>/g)];
  const credits = [];

  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    const end = sections[index + 1]?.index ?? cleanHtml.length;
    const content = cleanHtml.slice(section.index, end);

    for (const cell of content.matchAll(/<td\b[^>]*width="84%"[^>]*>([\s\S]*?)<\/td>/g)) {
      const artist = cell[1].match(/<span\b[^>]*class="theme-song-artist"[^>]*>([\s\S]*?)<\/span>/);
      if (!artist) continue;

      const titleText = plainText(cell[1].slice(0, artist.index));
      const title = titleText.replace(/^#?\d+\s*:\s*/, '').replace(/^"|"$/g, '').trim();
      const artistCredit = plainText(artist[1]).replace(/^by\s+/, '').trim();
      if (!title || !artistCredit) continue;

      credits.push({
        malId,
        type: section[1] === 'Opening' ? 'opening' : 'ending',
        title,
        artistCredit,
        sourceUrl: `https://myanimelist.net/anime/${malId}`,
      });
    }
  }

  return credits;
}

function releaseIds(song) {
  return [...new Set(song.releases.flatMap(release => release.sources
    .filter(source => /^https:\/\/myanimelist\.net\/anime\/\d+$/.test(source))
    .map(source => Number(source.split('/').pop()))))];
}

function filenameTitle(song) {
  const filename = decodeURIComponent(song.path).split('/').pop().replace(/\.mp3$/i, '').trim();
  const separator = filename.indexOf(' - ');
  return separator < 0 ? filename : filename.slice(separator + 3).trim();
}

export function classifySong(song, sources, review) {
  const relevantSources = sources.filter(source => releaseIds(song).includes(source.malId));
  const published = relevantSources.flatMap(source => source.credits).filter(credit => credit.type === song.type);
  const titles = [song.name, filenameTitle(song)];
  const normalizedTitles = titles.map(normalizeTitle).filter(Boolean);
  const matches = published.filter(credit => normalizedTitles.includes(normalizeTitle(credit.title)));
  const distinctArtists = [...new Set(matches.map(match => normalizeTitle(match.artistCredit)))];

  const entry = {
    songId: song.id,
    anime: song.anime,
    title: song.name,
    type: song.type,
    status: 'no_title_match',
    artistCredit: null,
    reason: 'No unique title match within the mapped releases and song type.',
    evidence: [],
  };

  if (review?.status === 'needs_title_review') {
    return {
      ...entry,
      status: review.status,
      reason: review.reason,
      evidence: published,
    };
  }

  // Localized broadcast titles need their own credit evidence. A Japanese theme
  // with the same anime or sequence must never be assigned as their performer.
  if (review?.status === 'localized_version_review') {
    return { ...entry, ...review, songId: song.id, anime: song.anime, title: song.name, type: song.type };
  }

  if (review?.sourceTitle) {
    const reviewed = published.filter(credit => normalizeTitle(credit.title) === normalizeTitle(review.sourceTitle));
    const artists = new Set(reviewed.map(credit => normalizeTitle(credit.artistCredit)));
    if (reviewed.length && artists.size === 1) {
      return {
        ...entry,
        status: 'reviewed_title_match',
        artistCredit: review.artistCredit ?? reviewed[0].artistCredit,
        reason: review.reason,
        evidence: reviewed,
        reviewReferences: review.references ?? [],
      };
    }
  }

  if (matches.length && distinctArtists.length === 1) {
    const exactStoredTitle = matches.some(match => normalizeTitle(match.title) === normalizeTitle(song.name));
    return {
      ...entry,
      status: exactStoredTitle ? 'unique_title_match' : 'filename_title_match',
      artistCredit: matches[0].artistCredit,
      reason: exactStoredTitle
        ? 'Unique normalized title/type match within provider-linked releases.'
        : 'The existing audio filename resolves a spelling difference in the stored title.',
      evidence: matches,
    };
  }

  if (distinctArtists.length > 1) {
    return { ...entry, status: 'conflicting_credits', reason: 'Matching releases list different performer credits.', evidence: matches };
  }

  if (relevantSources.some(source => source.status !== 200)) {
    return { ...entry, status: 'source_unavailable', reason: 'At least one mapped source page was unavailable; missing coverage is not evidence of missing credits.' };
  }

  return entry;
}

function markdownCell(value) {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
}

async function writeReport(songs) {
  const sources = JSON.parse(await fs.readFile(path.join(cacheDirectory, 'published-credits.json'), 'utf8'));
  const review = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'catalog/artist-coverage-review.json'), 'utf8'));
  const rows = songs.map(song => classifySong(song, sources, review.songs[String(song.id)]));
  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;

  const report = {
    auditedAt: new Date().toISOString(),
    scope: 'The owner confirmed original/broadcast recordings and Japanese-language recordings for Japanese-titled tracks. Audio waveforms were not independently verified.',
    source: 'Published MyAnimeList opening/ending credits, retrieved by existing release IDs.',
    songs: rows.length,
    releasePages: sources.length,
    unavailablePages: sources.filter(source => source.status !== 200).map(source => source.malId),
    sourceSnapshots: sources.map(source => ({ malId: source.malId, status: source.status, sha256: source.sha256 })),
    counts,
    rows,
  };
  await fs.writeFile(path.join(repositoryRoot, 'catalog/artist-coverage-audit.json'), `${JSON.stringify(report, null, 2)}\n`);

  const lines = [
    '# Artist coverage audit',
    '',
    'Audited November 2, 2026. Read-only: no database records, schema, media files or runtime game behavior were changed.',
    '',
    'The owner confirmed that uploads are original/broadcast recordings rather than fan covers, and that Japanese-titled tracks use Japanese recordings. Source matches use that confirmation; waveforms were not independently verified. Localized titles remain held for localized broadcast-credit review.',
    '',
    '## Coverage',
    '',
    `Usable original-theme credits: ${(counts.unique_title_match ?? 0) + (counts.filename_title_match ?? 0) + (counts.reviewed_title_match ?? 0)} of ${rows.length} songs, using the owner-confirmed recording provenance. Held for further identification: ${rows.filter(row => !row.artistCredit).length}.`,
    '',
    '| Result | Songs |',
    '| --- | ---: |',
    ...Object.entries(counts).map(([status, count]) => `| ${status} | ${count} |`),
    '',
    `Checked ${sources.length} mapped release pages; ${report.unavailablePages.length} pages were unavailable.`,
    '',
    '## Method and limitations',
    '',
    '- Start from all 125 songs and their existing canonical answer/release provider IDs, exported using SELECT only.',
    '- Match published opening/ending credits only within those release IDs and the stored song type. Normalize case, accents, punctuation and parenthetical Japanese spellings. Do not use global fuzzy title matching or the unreliable sequence numbers.',
    '- Use the existing filename as secondary spelling evidence. Explicit reviewed translations, romanizations and title corrections are documented in artist-coverage-review.json; no song names were changed. Supplement the performer field when the published title itself identifies a featured singer.',
    '- Preserve the full performer credit, including collaborations and featured artists. Do not silently truncate to the first singer or replace performers with composers.',
    '- Duplicate appearances with the same performer credit are compatible. Different performer credits remain ambiguous.',
    '- AnimeThemes returned an HTTP 403 access page. Jikan was unreachable. Neither failure is treated as zero coverage; this audit uses independently published MyAnimeList pages instead.',
    '- Source HTML and export stay in the ignored cache. Public facts, source URLs and review decisions are recorded here and in the JSON companion. This report is not an artist import or permission to publish uncertain credits.',
    '',
    '## Held songs',
    '',
    ...rows.filter(row => !row.artistCredit).map(row => `- **${row.songId}: ${row.anime} — ${row.title}.** ${row.reason}`),
    '',
    '## Storage decision',
    '',
    'The owner selected nullable public.songs.artist_credit for the display credit. Migration 005_song_artist_credits imports the 113 reviewed credits and leaves these 12 uncertain songs NULL. The legacy manual-game API now selects its original fields explicitly; multiplayer exposes optional artistCredit only in a revealed result. Evidence and review decisions remain in these audit files. The audit itself was read-only; applying the migration is a separate operation.',
    '',
    '## Reproduce',
    '',
    'Run the following from the backend repository. Export reads the configured database; fetch uses spaced public GETs and reuses the ignored source cache; report only reads local files. The final command runs the audit matching tests.',
    '',
    '```sh',
    'node --env-file=.dev.vars scripts/catalog/artist-coverage-audit.mjs export',
    'node scripts/catalog/artist-coverage-audit.mjs fetch',
    'node scripts/catalog/artist-coverage-audit.mjs report',
    'node --test test/catalog/artist-coverage.test.mjs',
    '```',
    '',
    '## Song-by-song results',
    '',
    '| ID | Anime | Stored song title | Performer credit | Result | Evidence / remaining work |',
    '| ---: | --- | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    const evidence = [...new Set([...row.evidence.map(item => item.sourceUrl), ...(row.reviewReferences ?? [])])]
      .map((url, index) => `[source ${index + 1}](${url})`).join(', ');
    lines.push(`| ${row.songId} | ${markdownCell(row.anime)} | ${markdownCell(row.title)} | ${markdownCell(row.artistCredit)} | ${row.status} | ${evidence || markdownCell(row.reason)} |`);
  }

  await fs.writeFile(path.join(repositoryRoot, 'catalog/artist-coverage-audit.md'), `${lines.join('\n')}\n`);
  console.log(JSON.stringify({ songs: rows.length, releasePages: sources.length, counts, unavailablePages: report.unavailablePages }));
}

async function fetchPublishedCredits(songs) {
  const ids = [...new Set(songs.flatMap(releaseIds))].sort((first, second) => first - second);
  const sources = [];

  for (const [index, malId] of ids.entries()) {
    const htmlFile = path.join(cacheDirectory, `mal-${malId}.html`);
    let html;
    let status = 200;

    try {
      html = await fs.readFile(htmlFile, 'utf8');
    } catch {
      // Sequential, spaced GETs avoid a burst against the source. Never retry an
      // access denial or save a challenge page as successfully retrieved metadata.
      await new Promise(resolve => setTimeout(resolve, 900));
      try {
        const response = await fetch(`https://myanimelist.net/anime/${malId}`, {
          signal: AbortSignal.timeout(15_000),
        });
        status = response.status;
        if (response.ok) {
          html = await response.text();
          await fs.writeFile(htmlFile, html);
        }
      } catch {
        status = 0;
      }
    }

    const credits = html ? parseThemeCredits(html, malId) : [];
    sources.push({
      malId,
      status,
      sha256: html ? createHash('sha256').update(html).digest('hex') : null,
      credits,
    });
    if ((index + 1) % 10 === 0 || index === ids.length - 1) {
      console.log(`Checked ${index + 1}/${ids.length} releases; ${sources.reduce((count, source) => count + source.credits.length, 0)} published theme credits.`);
    }
  }

  await fs.writeFile(path.join(cacheDirectory, 'published-credits.json'), `${JSON.stringify(sources, null, 2)}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const command = process.argv[2];
  if (command === 'export') {
    try {
      await exportSongs();
    } catch {
      console.error('Read-only export failed. Check database access and configured credentials.');
      process.exitCode = 1;
    }
  } else if (command === 'fetch' || command === 'report') {
    const songs = JSON.parse(await fs.readFile(path.join(cacheDirectory, 'songs.json'), 'utf8'));
    if (command === 'fetch') await fetchPublishedCredits(songs);
    else await writeReport(songs);
  } else {
    throw new Error('Usage: node scripts/catalog/artist-coverage-audit.mjs export|fetch|report');
  }
}
