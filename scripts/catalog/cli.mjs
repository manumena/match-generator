import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { buildPlan, sha256 } from './plan.mjs';
import { applyImport, legacyFingerprint } from './import.mjs';

const root = fileURLToPath(new URL('../../',import.meta.url));
const { values, positionals } = parseArgs({ allowPositionals:true, options: {
  file:{type:'string'}, songs:{type:'string'}, host:{type:'string'}, database:{type:'string'},
  out:{type:'string'}, apply:{type:'boolean',default:false},
} });
const command=positionals[0];
const snapshot=JSON.parse(await fs.readFile(path.join(root,'catalog/snapshot.json'),'utf8'));
const mappingBytes=await fs.readFile(path.join(root,'catalog/season-mappings.json'));
const mappings=JSON.parse(mappingBytes.toString('utf8'));

async function connect() {
  if(!values.host || !values.database) throw new Error('Provide --host and --database explicitly; no implicit production target');
  if(!/^[a-z0-9.-]+\.neon\.tech$/.test(values.host) || values.host.includes('-pooler.')) throw new Error('Use a direct Neon host');
  if(!process.env.DB_USERNAME || !process.env.DB_PASSWORD) throw new Error('Load DB_USERNAME and DB_PASSWORD using --env-file=.dev.vars');
  const url=new URL(`postgresql://${values.host}/${encodeURIComponent(values.database)}`);
  url.username=process.env.DB_USERNAME;url.password=process.env.DB_PASSWORD;url.searchParams.set('sslmode','require');
  neonConfig.webSocketConstructor=globalThis.WebSocket;
  const pool=new Pool({connectionString:url.toString(),max:1,connectionTimeoutMillis:15000});
  pool.on('error',()=>{console.error('Database connection failed');process.exitCode=1;});
  try { return {pool,client:await pool.connect()}; } catch(error) {await pool.end();throw error;}
}

async function main() {
  if(command==='download') {
    if(!values.out) throw new Error('Provide --out for the snapshot file (keep generated data out of Git)');
    const response=await fetch(snapshot.url);
    if(!response.ok) throw new Error(`Snapshot download failed: HTTP ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(sha256(bytes)!==snapshot.sha256) throw new Error('Downloaded snapshot checksum mismatch');
    await fs.mkdir(path.dirname(path.resolve(values.out)),{recursive:true});
    await fs.writeFile(values.out,bytes);
    console.log(`Verified snapshot ${snapshot.version}: ${bytes.length} bytes`);
    return;
  }
  if(!['plan','import'].includes(command)) throw new Error('Usage: catalog <download|plan|import> --file <snapshot> [--songs <json>] [--host <direct-host> --database <db> --apply]');
  if(!values.file) throw new Error('Provide --file with the pinned snapshot');
  const bytes=await fs.readFile(values.file);
  // Validate the entire catalog and mappings before opening a connection.
  buildPlan(bytes,snapshot,mappings);
  if(command==='plan') {
    const songs=values.songs?JSON.parse(await fs.readFile(values.songs,'utf8')):[];
    const plan=buildPlan(bytes,snapshot,mappings,songs);
    const report={importId:plan.importId,...plan.summary};
    if(values.out) await fs.writeFile(values.out,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
    return;
  }
  const {pool,client}=await connect();
  try {
    const songsBefore=await legacyFingerprint(client);
    const {rows:songs}=await client.query('SELECT id,anime FROM public.songs ORDER BY id');
    const plan=buildPlan(bytes,snapshot,mappings,songs);
    console.log(JSON.stringify({target:{host:values.host,database:values.database},...plan.summary,apply:values.apply}));
    if(!values.apply) return;
    const migrationSql=await fs.readFile(path.join(root,'migrations/001_catalog.sql'),'utf8');
    const result=await applyImport(client,{plan,snapshot,mappingBytes,migrationSql,songsBefore,log:console.log});
    console.log(JSON.stringify(result,null,2));
  } finally {client.release();await pool.end();}
}

try {await main();} catch(error) {
  const message=String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted connection]');
  console.error(message);
  process.exitCode=1;
}
