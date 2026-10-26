import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { sha256 } from '../../scripts/catalog/plan.mjs';
import {
  readLanguageEvidence,
  planAliasLanguages,
} from '../../scripts/catalog/alias-languages.mjs';
import { applyAliasCleanup } from '../../scripts/catalog/alias-cleanup.mjs';

function fixture() {
  const dump = gzipSync(
    [
      '# test language evidence',
      '1|1|x-jat|Naruto',
      '1|2|x-jat|Shippuuden',
      '1|4|ja|ナルト',
      '1|4|es-419|Naruto: Segunda temporada',
      '1|2|zh-Hans|火影忍者',
      '1|2|de|Die Abenteuer des Jungen',
      '1|2|fr|Red Eyes Sword',
      '2|4|en|Red Eyes Sword',
      '1|2|pt|My Hero Academia - Temporada 2',
      '1|2|fr|Unclear name',
      '1|2|x-unk|Unclear name',
    ].join('\n'),
  );
  const source = { sha256: sha256(dump), policy: 'test-policy' };
  const names = [
    'Naruto',
    'Shippuuden',
    'ナルト',
    'Naruto: Segunda temporada',
    '火影忍者',
    'Die Abenteuer des Jungen',
    'Red Eyes Sword',
    'My Hero Academia - Temporada 2',
    'Unclear name',
    '忍者',
    'Unknown romaji',
    'Русское название',
    'Title Δ',
  ];
  return {
    dump,
    source,
    data: {
      anime: [{ id: 42, title: 'Naruto' }],
      aliases: names.map((alias) => ({ anime_id: 42, alias, provenance: 'snapshot' })),
      releases: [{ anime_id: 42, source_urls: ['https://anidb.net/anime/1'] }],
      identities: [{ original_id: 42, canonical_id: 42 }],
    },
  };
}

test('keeps English, Spanish, Japanese, romaji, shared spellings and uncertain titles', () => {
  const { dump, source, data } = fixture();
  const evidence = readLanguageEvidence(dump, source);
  const review = new Map([['Die Abenteuer des Jungen', 'de']]);
  const plan = planAliasLanguages(data, evidence, review);
  assert.deepEqual(
    plan.excluded.map((row) => row.alias),
    ['火影忍者', 'Die Abenteuer des Jungen', 'Русское название'],
  );
  assert.equal(plan.excluded[0].reason, 'anidb-language-tags');
  assert.equal(plan.excluded[2].reason, 'unsupported-script:Cyrillic');
});

test('locale metadata alone cannot remove Latin titles; checksum failures abort the audit', () => {
  const { dump, source, data } = fixture();
  const plan = planAliasLanguages(data, readLanguageEvidence(dump, source));
  assert.ok(!plan.excluded.some((row) => row.alias === 'Die Abenteuer des Jungen'));
  assert.throws(() => readLanguageEvidence(dump, { sha256: 'wrong' }), /checksum/);
});

test('supported language evidence across redirected releases wins over another locale tag', () => {
  const { dump, source, data } = fixture();
  data.releases.push({ anime_id: 99, source_urls: ['https://anidb.net/anime/2'] });
  data.identities.push({ original_id: 99, canonical_id: 42 });
  data.aliases.push({ anime_id: 99, alias: 'Red Eyes Sword', provenance: 'snapshot' });
  const plan = planAliasLanguages(data, readLanguageEvidence(dump, source));
  assert.ok(!plan.excluded.some((row) => row.alias === 'Red Eyes Sword'));
});

// A mismatch at either write must undo the archive and every preceding deletion.
test('archives before deleting and rolls back stale plans or changed rows', async () => {
  const { dump, source, data } = fixture();
  const plan = planAliasLanguages(data, readLanguageEvidence(dump, source));
  for (const failure of [null, 'archive', 'delete']) {
    const calls = [];
    const client = {
      query: async (sql) => {
        calls.push(sql);
        if (sql.includes('INSERT INTO catalog.excluded_aliases'))
          return { rowCount: failure === 'archive' ? 0 : plan.excluded.length };
        if (sql.includes('DELETE FROM catalog.aliases'))
          return { rowCount: failure === 'delete' ? 0 : plan.excluded.length };
        return { rows: [] };
      },
    };
    const action = applyAliasCleanup(client, { plan, source, migrationSql: '-- migration' });
    if (failure) {
      await assert.rejects(action);
      assert.equal(calls.at(-1), 'ROLLBACK');
    } else {
      assert.equal((await action).removedActiveAliases, plan.excluded.length);
      assert.equal(calls.at(-1), 'COMMIT');
      assert.ok(
        calls.findIndex((sql) => sql.includes('INSERT INTO catalog.excluded_aliases')) <
          calls.findIndex((sql) => sql.includes('DELETE FROM catalog.aliases')),
      );
    }
  }
});
