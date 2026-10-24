import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, sha256 } from '../../scripts/catalog/plan.mjs';
import { applyImport } from '../../scripts/catalog/import.mjs';

function fixture() {
  const row=(id,title,aliases=[])=>({title,sources:[`https://myanimelist.net/anime/${id}`],synonyms:aliases,
    type:'TV',animeSeason:{year:2020},relatedAnime:[],picture:'https://example.com/image.jpg',thumbnail:'https://example.com/thumb.jpg'});
  const data=[row(20,'Naruto',['NARUTO']),row(1735,'Naruto: Shippuuden',['Naruto Shippuden']),
    row(100,'Regular Season 1',['Shared abbreviation']),row(101,'Regular Season 2'),row(102,'No songs',['Shared abbreviation'])];
  const bytes=Buffer.from(JSON.stringify({lastUpdate:'2026-07-04',data}));
  const snapshot={version:'2026-27',sha256:sha256(bytes),entries:data.length,lastUpdate:'2026-07-04'};
  const group=(key,ids,labels)=>({key,title:key,members:ids.map(i=>`https://myanimelist.net/anime/${i}`),
    representativeSource:`https://myanimelist.net/anime/${ids[0]}`,legacyLabels:labels,aliases:[]});
  const mappings={version:1,snapshot:snapshot.version,groups:[group('naruto',[20],['Naruto']),
    group('shippuden',[1735],['Naruto Shippuden']),group('regular',[100,101],['Regular'])]};
  const songs=[{id:1,anime:'Naruto'},{id:2,anime:'Naruto Shippuden'},{id:3,anime:'Regular'}];
  return {bytes,snapshot,mappings,songs};
}
const run=f=>buildPlan(f.bytes,f.snapshot,f.mappings,f.songs);

test('groups explicit seasons but keeps major sequels distinct and retains anime with no songs',()=>{
  const plan=run(fixture());
  assert.equal(plan.anime.length,4);
  assert.notEqual(plan.songs[0].anime_key,plan.songs[1].anime_key);
  assert.equal(plan.releases.find(r=>r.title==='Regular Season 2').anime_key,'curated:regular');
  assert.ok(plan.anime.some(a=>a.title==='No songs'));
  assert.equal(plan.aliases.filter(a=>a.alias==='Shared abbreviation').length,2);
  assert.equal(plan.releases[0].picture_url,'https://example.com/image.jpg');
});

test('stable identities do not depend on input ordering or display-title spelling',()=>{
  const f=fixture();const first=run(f);
  const source=JSON.parse(f.bytes);source.data.reverse();source.data[0].title='Corrected spelling';
  f.bytes=Buffer.from(JSON.stringify(source));f.snapshot.sha256=sha256(f.bytes);
  const second=run(f);
  assert.deepEqual(first.anime.map(a=>a.stable_key),second.anime.map(a=>a.stable_key));
  assert.deepEqual(first.releases.map(r=>r.stable_key),second.releases.map(r=>r.stable_key));
});

test('fails closed for an unknown legacy song label instead of guessing by fuzzy title',()=>{
  const f=fixture();f.songs.push({id:4,anime:'Narutoo'});
  assert.throws(()=>run(f),/Unmapped song anime/);
});

test('rejects changed snapshots, missing members and conflicting season assignments',()=>{
  let f=fixture();f.snapshot.sha256='incorrect';assert.throws(()=>run(f),/checksum/);
  f=fixture();f.mappings.groups[0].members.push('https://myanimelist.net/anime/999');assert.throws(()=>run(f),/Unknown curated member/);
  f=fixture();f.mappings.groups[0].members.push('https://myanimelist.net/anime/1735');assert.throws(()=>run(f),/assigned more than once/);
});

test('rejects source URL collisions instead of merging unrelated provider records',()=>{
  const f=fixture();const source=JSON.parse(f.bytes);source.data[1].sources=source.data[0].sources;
  f.bytes=Buffer.from(JSON.stringify(source));f.snapshot.sha256=sha256(f.bytes);
  assert.throws(()=>run(f),/duplicate source URL/);
});

test('rolls back schema and catalog writes together if a bulk insert fails',async()=>{
  const f=fixture();const plan=run(f);const calls=[];
  const client={query:async(sql)=>{calls.push(sql);if(sql.startsWith('INSERT INTO catalog.anime'))throw new Error('simulated insert failure');return {rows:[]};}};
  await assert.rejects(applyImport(client,{plan,snapshot:f.snapshot,mappingBytes:Buffer.from('{}'),migrationSql:'CREATE SCHEMA catalog;',songsBefore:{}}),/simulated insert failure/);
  assert.equal(calls[0],'BEGIN');assert.equal(calls.at(-1),'ROLLBACK');assert.ok(!calls.includes('COMMIT'));
});
