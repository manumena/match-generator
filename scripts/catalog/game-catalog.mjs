import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';

// Run against the frontend export that is already published. Keeping each version
// immutable prevents a deployment from silently rewriting active-match choices.
const directory = resolve(process.argv[2] ?? '../animasters/public/catalog');
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
const bytes = await readFile(resolve(directory, basename(manifest.url)));
if (createHash('sha256').update(bytes).digest('hex') !== manifest.version) {
  throw new Error('Catalog bytes do not match the published version.');
}
const data = JSON.parse(bytes);
if (data.schemaVersion !== 4 || data.scope !== 'series' || data.entries.length !== manifest.entries) {
  throw new Error('Unsupported or incomplete game catalog.');
}
const payload = JSON.stringify({
  version: manifest.version,
  titles: Object.fromEntries(data.entries.map(([id, title]) => [id, title])),
}) + '\n';
const target = resolve(`src/rooms/catalog/answers.${manifest.version}.json`);
try {
  await writeFile(target, payload, { flag: 'wx' });
} catch (error) {
  if (error.code !== 'EEXIST' || await readFile(target, 'utf8') !== payload) throw error;
}
console.log(`Validated ${data.entries.length} game answer IDs for ${manifest.version}.`);
