import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import process from 'node:process';
import console from 'node:console';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Trust exact frontend origins on this machine, not every device on the LAN.
// Vite forwards the original browser Origin through its HTTPS/WebSocket proxy.
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
  .map((entry) => entry.address);
const names = [...new Set(['localhost', '127.0.0.1', '[::1]', ...addresses])];
const origins = names.map((name) => `https://${name}:3000`);
origins.push('http://localhost:3000', 'http://127.0.0.1:3000');

// CLI variables are local overrides; deployed Worker settings stay unchanged.
// Resolve the installed CLI directly so npm and Yarn can both run this script.
const require = createRequire(import.meta.url);
const wranglerDirectory = dirname(require.resolve('wrangler/package.json'));
const worker = spawn(
  process.execPath,
  [
    join(wranglerDirectory, 'bin/wrangler.js'),
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    '8787',
    '--var',
    `ROOM_ORIGINS:${origins.join(',')}`,
  ],
  { stdio: 'inherit' },
);

worker.on('error', (error) => {
  console.error(`Could not start Wrangler: ${error.message}`);
  process.exitCode = 1;
});
worker.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => worker.kill(signal));
}
