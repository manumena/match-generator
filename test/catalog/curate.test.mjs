import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCuration, applyCuration } from '../../scripts/catalog/curate.mjs';

const document = {
  version: 'test-1',
  metadata: [{ source: 'a', priority: 90, reason: 'Editorial, not a rating' }],
  redirects: [{ source: 'b', target: 'a', reason: 'Reviewed duplicate work' }],
};

test('resolves explicit provider references to existing IDs without fuzzy merging', async () => {
  const client = {
    query: async () => ({
      rows: [
        { source: 'a', id: 42 },
        { source: 'b', id: 99 },
      ],
    }),
  };
  const plan = await resolveCuration(client, document);
  assert.equal(plan.metadata[0].anime_id, 42);
  assert.deepEqual(plan.redirects[0], {
    anime_id: 99,
    canonical_id: 42,
    reason: 'Reviewed duplicate work',
  });
  await assert.rejects(
    resolveCuration(client, {
      ...document,
      metadata: [{ ...document.metadata[0], priority: 101 }],
    }),
    /priority/,
  );
  await assert.rejects(
    resolveCuration(client, {
      ...document,
      redirects: [{ source: 'a', target: 'a', reason: 'Bad self redirect' }, ...document.redirects],
    }),
    /acyclic/,
  );
});

test('refuses incomplete reference resolution', async () => {
  await assert.rejects(resolveCuration({ query: async () => ({ rows: [] }) }, document), /missing/);
});

test('rolls back curation when a database write fails', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.startsWith('SELECT x.source'))
        return {
          rows: [
            { source: 'a', id: 42 },
            { source: 'b', id: 99 },
          ],
        };
      if (sql.startsWith('INSERT INTO catalog.search_metadata')) throw new Error('write failed');
      return { rows: [] };
    },
  };
  await assert.rejects(
    applyCuration(client, { document, bytes: Buffer.from('{}'), migrationSql: '-- migration' }),
    /write failed/,
  );
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.ok(!calls.includes('COMMIT'));
});
