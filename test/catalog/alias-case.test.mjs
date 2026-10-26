import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueCaseAliases, planAliasCaseDuplicates } from '../../scripts/catalog/alias-case.mjs';

test('removes case variants of the display title and retains the original first alias spelling', () => {
  assert.deepEqual(uniqueCaseAliases('Naruto', ['naruto', 'NARUTO', 'NTV', 'ntv', 'Naruto!']), [
    'NTV',
    'Naruto!',
  ]);
});

test('preserves accents, punctuation, whitespace and distinct anime identities', () => {
  const names = ['Pokémon', 'POKÉMON', 'Pokemon', 'Pokemon!', 'Poke mon'];
  assert.deepEqual(uniqueCaseAliases('Different title', names), [
    'POKÉMON',
    'Poke mon',
    'Pokemon',
    'Pokemon!',
  ]);
  const rows = [
    { anime_id: 1, alias: 'Naruto', provenance: 'curated' },
    { anime_id: 1, alias: 'NARUTO', provenance: 'snapshot' },
    { anime_id: 2, alias: 'Naruto', provenance: 'snapshot' },
  ];
  const plan = planAliasCaseDuplicates(rows);
  assert.deepEqual(
    plan.excluded.map((row) => [row.anime_id, row.alias]),
    [[1, 'Naruto']],
  );
  assert.equal(plan.excluded[0].provenance, 'curated');
  assert.equal(plan.retainedAliasRows, 2);
  assert.deepEqual(planAliasCaseDuplicates(rows.toReversed()), plan);
});

test('cleanup is idempotent and retains Japanese and romanized names', () => {
  const aliases = ['ナルト', 'NARUTO', 'Naruto', 'Shippuuden', 'SHIPPUUDEN'];
  const compact = uniqueCaseAliases('Naruto', aliases);
  assert.deepEqual(compact, ['SHIPPUUDEN', 'ナルト']);
  assert.deepEqual(uniqueCaseAliases('Naruto', compact), compact);
});
