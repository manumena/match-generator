import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEpisodeCounts, ensureEpisodeSchema } from '../../scripts/catalog/episodes.mjs';
import { sha256 } from '../../scripts/catalog/plan.mjs';

const migrationSql = 'ALTER TABLE catalog.releases ADD COLUMN episodes integer;';
const snapshot = { sha256: 'pinned-source' };
const plan = {
  importId: 'pinned-import',
  releases: [
    { stable_key: 'source-a', episodes: 12 },
    { stable_key: 'source-b', episodes: null },
  ],
};

// Capture transaction boundaries and simulate a previously verified catalog import.
function database({ sourceHash = snapshot.sha256, missing = 0, failWrite = false } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      if (sql.includes('SELECT source_sha256')) return { rows: [{ source_sha256: sourceHash }] };
      if (sql.includes('AS count')) return { rows: [{ count: missing }] };
      if (sql.includes('UPDATE catalog.releases')) {
        if (failWrite) throw new Error('write failed');
        return { rowCount: 1 };
      }
      return { rows: [] };
    },
  };
}

test('backfills only missing counts and commits the migration and data together', async () => {
  const client = database();
  const result = await applyEpisodeCounts(client, { plan, snapshot, migrationSql });
  assert.equal(result.updatedEpisodeCounts, 1);
  assert.equal(client.calls[0].sql, 'BEGIN');
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
  const update = client.calls.find((call) => call.sql.includes('UPDATE catalog.releases'));
  assert.match(update.sql, /release.episodes IS NULL AND input.episodes IS NOT NULL/);
  assert.deepEqual(JSON.parse(update.parameters[0]), plan.releases);
});

test('rolls back mismatched source data, missing releases, and write failures', async () => {
  for (const options of [{ sourceHash: 'other-source' }, { missing: 1 }, { failWrite: true }]) {
    const client = database(options);
    await assert.rejects(applyEpisodeCounts(client, { plan, snapshot, migrationSql }));
    assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
    assert.ok(!client.calls.some((call) => call.sql === 'COMMIT'));
  }
});

test('repeat migrations retain their identity and reject changed SQL', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      return { rows: [{ sha256: sha256(migrationSql) }] };
    },
  };
  await ensureEpisodeSchema(client, migrationSql);
  assert.equal(calls.length, 1);
  await assert.rejects(ensureEpisodeSchema(client, migrationSql + '-- edited'), /checksum changed/);
});
