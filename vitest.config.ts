import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({
    // Keep tests isolated from local secrets and the deployed database.
    main: './src/index.ts',
    miniflare: { compatibilityDate: '2026-10-19' },
  })],
});
