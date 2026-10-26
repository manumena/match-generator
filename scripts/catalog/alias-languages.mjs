import { gunzipSync, gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { sha256 } from './plan.mjs';
import { encodeCatalog } from './export.mjs';

// AniDB's x-jat is Japanese transliteration (romaji), which remains searchable.
// es-CA/es-GA/es-PV describe Catalan/Galician/Basque, not Spanish variants.
const ALLOWED_LANGUAGES = new Set(['en', 'es', 'es-419', 'ja', 'x-jat']);
const UNKNOWN_LANGUAGES = new Set(['x-unk', 'x-other']);
const JAPANESE_KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LETTER = /\p{Letter}/u;
const UNSUPPORTED_SCRIPTS = [
  'Cyrillic',
  'Arabic',
  'Hangul',
  'Thai',
  'Hebrew',
  'Devanagari',
  'Bengali',
  'Greek',
  'Tamil',
  'Telugu',
  'Myanmar',
  'Georgian',
  'Armenian',
  'Sinhala',
  'Gujarati',
  'Gurmukhi',
  'Kannada',
  'Malayalam',
  'Khmer',
  'Lao',
].map((name) => ({ name, pattern: new RegExp(`\\p{Script=${name}}`, 'u') }));

/** Match spelling variants only; never infer language from a title's meaning. */
function normalizeAlias(alias) {
  return alias.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
}

export function readLanguageEvidence(bytes, source) {
  if (sha256(bytes) !== source.sha256) throw new Error('Language source checksum mismatch');
  const byProvider = new Map();
  for (const line of gunzipSync(bytes).toString('utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const match = /^(\d+)\|[1-6]\|([^|]+)\|(.+)$/.exec(line);
    if (!match) throw new Error('Invalid language source record');
    const [, providerId, language, title] = match;
    const aliases = byProvider.get(providerId) ?? new Map();
    const key = normalizeAlias(title);
    const languages = aliases.get(key) ?? new Set();
    languages.add(language);
    aliases.set(key, languages);
    byProvider.set(providerId, aliases);
  }
  if (!byProvider.size) throw new Error('Empty language source');
  return byProvider;
}

function unsupportedScript(alias) {
  const letters = [...alias].filter((character) => LETTER.test(character));
  // A single decorative character is not evidence of a translated title.
  for (const { name, pattern } of UNSUPPORTED_SCRIPTS) {
    const count = letters.filter((character) => pattern.test(character)).length;
    if (count >= 3 && count > letters.length / 2) return name;
  }
}

/** Plan deletions conservatively; unlabelled Latin/Han titles remain for review. */
export function planAliasLanguages(
  { aliases, releases, anime, identities },
  evidence,
  latinReview = new Map(),
) {
  const canonicalIds = new Map(identities.map((row) => [row.original_id, row.canonical_id]));
  const canonicalId = (id) => canonicalIds.get(id) ?? id;
  const providers = new Map();
  const primaryTitles = new Map();

  // Season mappings and redirects can combine provider releases into one answer.
  for (const row of releases) {
    const id = canonicalId(row.anime_id);
    const ids = providers.get(id) ?? new Set();
    for (const url of row.source_urls) {
      const match = /^https:\/\/anidb\.net\/anime\/(\d+)$/.exec(url);
      if (match) ids.add(match[1]);
    }
    providers.set(id, ids);
  }
  for (const row of anime) {
    const id = canonicalId(row.id);
    const titles = primaryTitles.get(id) ?? new Set();
    titles.add(normalizeAlias(row.title));
    primaryTitles.set(id, titles);
  }

  // A spelling used in any supported-language title remains safe to retain,
  // even when one provider labels that same spelling as another localization.
  const sharedSpellings = new Set();
  const spelling = (text) => normalizeAlias(text).replace(/[^\p{Letter}\p{Number}]/gu, '');
  for (const titles of evidence.values()) {
    for (const [title, languages] of titles) {
      if ([...languages].some((language) => ALLOWED_LANGUAGES.has(language)))
        sharedSpellings.add(spelling(title));
    }
  }
  for (const titles of primaryTitles.values()) {
    for (const title of titles) sharedSpellings.add(spelling(title));
  }

  const excluded = [];
  const retainedReasons = {};
  for (const row of aliases) {
    const id = canonicalId(row.anime_id);
    const key = normalizeAlias(row.alias);
    const languages = new Set();
    for (const provider of providers.get(id) ?? []) {
      for (const language of evidence.get(provider)?.get(key) ?? []) languages.add(language);
    }

    let keepReason;
    let exclusionReason;
    if ([...languages].some((language) => ALLOWED_LANGUAGES.has(language))) {
      keepReason = 'allowed-language-evidence';
    } else if (sharedSpellings.has(spelling(row.alias)) || row.provenance === 'curated') {
      keepReason = 'shared-or-curated-spelling';
    } else if (JAPANESE_KANA.test(row.alias)) {
      keepReason = 'japanese-kana';
    } else if ([...languages].some((language) => UNKNOWN_LANGUAGES.has(language))) {
      keepReason = 'ambiguous-language-evidence';
    } else if (languages.size) {
      // Locale labels can contain English or Spanish text. Latin titles need
      // a second, pinned review agreeing with the source before removal.
      const latinOnly = [...row.alias]
        .filter((character) => LETTER.test(character))
        .every((character) => /\p{Script=Latin}/u.test(character));
      const reviewedLanguage = latinReview.get(row.alias);
      const languageCodes = [...languages].map(
        (language) =>
          ({
            'pt-BR': 'pt',
            'es-CA': 'ca',
            'es-GA': 'gl',
            'es-PV': 'eu',
          })[language] ?? language,
      );
      const approvedLatin =
        reviewedLanguage &&
        !ALLOWED_LANGUAGES.has(reviewedLanguage) &&
        languageCodes.includes(reviewedLanguage);
      if (latinOnly && !approvedLatin) keepReason = 'ambiguous-latin-localization';
      else exclusionReason = 'anidb-language-tags';
    } else {
      const script = unsupportedScript(row.alias);
      if (script) exclusionReason = `unsupported-script:${script}`;
      else keepReason = 'unclassified';
    }

    if (keepReason) retainedReasons[keepReason] = (retainedReasons[keepReason] ?? 0) + 1;
    else excluded.push({ ...row, languages: [...languages].sort(), reason: exclusionReason });
  }

  return { excluded, retainedReasons };
}

/** Measure the exact published representation, including compression effects. */
export function catalogSizes(bytes) {
  return {
    rawBytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length,
    brotliBytes: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
    }).length,
  };
}

export function measureAliasSavings(data, plan, snapshot) {
  const canonicalIds = new Map(data.identities.map((row) => [row.original_id, row.canonical_id]));
  const retained = new Set();
  const excluded = new Set(plan.excluded.map((row) => JSON.stringify([row.anime_id, row.alias])));

  // An alias survives if another member of its canonical group still owns it.
  for (const row of data.aliases) {
    if (excluded.has(JSON.stringify([row.anime_id, row.alias]))) continue;
    retained.add(JSON.stringify([canonicalIds.get(row.anime_id) ?? row.anime_id, row.alias]));
  }
  for (const row of data.anime) {
    retained.add(JSON.stringify([canonicalIds.get(row.id) ?? row.id, row.title]));
  }
  const answers = data.answers.map((row) => ({
    ...row,
    aliases: row.aliases.filter((alias) => retained.has(JSON.stringify([row.id, alias]))),
  }));
  const before = encodeCatalog(data.answers, snapshot);
  const after = encodeCatalog(answers, snapshot);
  return {
    activeAliasRowsBefore: data.aliases.length,
    excludedAliasRows: plan.excluded.length,
    activeAliasRowsAfter: data.aliases.length - plan.excluded.length,
    excludedAliasUtf8Bytes: plan.excluded.reduce(
      (sum, row) => sum + Buffer.byteLength(row.alias),
      0,
    ),
    retainedReasons: plan.retainedReasons,
    before: { aliases: before.manifest.aliases, ...catalogSizes(before.bytes) },
    after: { aliases: after.manifest.aliases, ...catalogSizes(after.bytes) },
    excludedByReason: Object.fromEntries(
      [...new Set(plan.excluded.map((row) => row.reason))].map((reason) => [
        reason,
        plan.excluded.filter((row) => row.reason === reason).length,
      ]),
    ),
  };
}
