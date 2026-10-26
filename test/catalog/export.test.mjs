import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodeCatalog, readAnswers, writeCatalog } from '../../scripts/catalog/export.mjs';

const snapshot = {
  version: '2026-27',
  attribution: 'Manami',
  license: 'ODbL-1.0 AND DbCL-1.0',
  url: 'https://example.com/source',
};
const rows = [
  {
    id: 42,
    title: 'Naruto',
    format: 'TV',
    aliases: ['NARUTO', 'Naruto'],
    path: 'private.mp3',
    picture_url: 'private.jpg',
  },
  { id: 43, title: 'Naruto Shippuden', format: 'TV', aliases: ['Shippuden'] },
  { id: 900, title: 'No playable songs', format: 'ONA', episodes: 12, aliases: [] },
];

test('exports only stable IDs, titles and deduplicated aliases, regardless of song availability', () => {
  const result = encodeCatalog(rows, snapshot);
  assert.deepEqual(JSON.parse(result.bytes).entries, [
    [42, 'Naruto', [], 0, ['TV', null, null]],
    [43, 'Naruto Shippuden', ['Shippuden'], 0, ['TV', null, null]],
    [900, 'No playable songs', [], 0, ['ONA', null, 12]],
  ]);
  assert.equal(result.manifest.entries, 3);
  assert.equal(result.manifest.aliases, 1);
  assert.equal(result.manifest.bytes, result.bytes.length);
});

test('content version changes with content but not alias ordering or duplicates', () => {
  const original = encodeCatalog(rows, snapshot);
  assert.equal(
    original.manifest.version,
    encodeCatalog(
      [{ ...rows[0], aliases: ['Naruto', 'NARUTO', 'NARUTO'] }, ...rows.slice(1)],
      snapshot,
    ).manifest.version,
  );
  assert.notEqual(
    original.manifest.version,
    encodeCatalog([{ ...rows[0], title: 'Changed title' }, ...rows.slice(1)], snapshot).manifest
      .version,
  );
  assert.throws(() => encodeCatalog([rows[0], rows[0]], snapshot), /Invalid answer/);
  assert.throws(() => encodeCatalog([], snapshot), /empty/);
});

test('export opens an explicitly read-only consistent transaction and rolls back on failure', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.trimStart().startsWith('SELECT')) throw new Error('offline');
      return {};
    },
  };
  await assert.rejects(readAnswers(client), /offline/);
  assert.equal(calls[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(calls.at(-1), 'ROLLBACK');
});

test('publishes a manifest, preserves older versions, and refuses to overwrite immutable bytes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anime-export-'));
  try {
    const first = encodeCatalog(rows, snapshot);
    const next = encodeCatalog(
      [...rows, { id: 901, title: 'New answer', format: 'TV', aliases: [] }],
      snapshot,
    );
    await writeCatalog(directory, first, 'License');
    await writeCatalog(directory, first, 'License');
    await writeCatalog(directory, next, 'License');
    assert.equal(
      JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'))).version,
      next.manifest.version,
    );
    const firstPath = path.join(directory, path.basename(first.manifest.url));
    assert.deepEqual(await fs.readFile(firstPath), first.bytes);
    await fs.writeFile(firstPath, 'corrupt');
    await assert.rejects(writeCatalog(directory, first, 'License'), /different bytes/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('includes bounded editorial rank and release details without song information', () => {
  const result = encodeCatalog([{ ...rows[0], priority: 90, format: 'TV', year: 2002 }], snapshot);
  assert.deepEqual(JSON.parse(result.bytes).entries[0].slice(3), [90, ['TV', 2002, null]]);
  assert.throws(() => encodeCatalog([{ ...rows[0], priority: 101 }], snapshot), /Invalid answer/);
});

test('only TV and web-series formats can enter the browser asset', () => {
  for (const format of ['MOVIE', 'OVA', 'SPECIAL', 'UNKNOWN', null]) {
    assert.throws(() => encodeCatalog([{ ...rows[0], format }], snapshot), /TV\/web series/);
  }
  const result = encodeCatalog(rows, snapshot);
  assert.equal(result.manifest.scope, 'series');
  assert.equal(JSON.parse(result.bytes).scope, 'series');
});

test('selects eligible releases across canonical groups before exporting answers', async () => {
  const calls = [];
  const client = {
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      if (sql.includes('AS count')) return { rows: [{ count: 0 }] };
      if (sql.includes('WITH eligible_releases')) return { rows };
      return {};
    },
  };
  assert.deepEqual(await readAnswers(client), rows);
  const selection = calls.find((call) => call.sql.includes('WITH eligible_releases'));
  assert.match(selection.sql, /release.episodes > 1/);
  assert.match(selection.sql, /JOIN representatives/);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('web releases require multiple known episodes, while TV remains eligible', () => {
  for (const episodes of [null, undefined, 0, 1, -1, 2.5]) {
    assert.throws(
      () => encodeCatalog([{ ...rows[0], format: 'ONA', episodes }], snapshot),
      /Invalid answer/,
    );
  }
  assert.doesNotThrow(() => encodeCatalog([{ ...rows[0], format: 'ONA', episodes: 2 }], snapshot));
  assert.doesNotThrow(() => encodeCatalog([{ ...rows[0], episodes: null }], snapshot));
  assert.doesNotThrow(() => encodeCatalog([{ ...rows[0], episodes: 1 }], snapshot));
});
