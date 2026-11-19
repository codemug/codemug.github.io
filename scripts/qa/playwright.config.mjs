import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Workers inherit this run ID, so every process in one run shares artifacts,
// while a second runner cannot delete the first runner's trace files.
const runId = process.env.CODEMUG_PLAYWRIGHT_RUN_ID ??= `${Date.now()}-${process.pid}`;

export default defineConfig({
  testDir: '../../tests/browser',
  outputDir: join(tmpdir(), 'codemug-playwright-results', runId),
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4325',
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark',
    trace: 'retain-on-failure',
  },
  // Build first. Playwright owns this server and stops it even if a test fails.
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4325',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    url: 'http://127.0.0.1:4325',
    reuseExistingServer: false,
  },
});
