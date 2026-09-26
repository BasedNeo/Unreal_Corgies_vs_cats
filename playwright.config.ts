import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Uses the pre-installed Chromium when present (cloud containers), else Playwright's own.
const localChrome = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      executablePath: existsSync(localChrome) ? localChrome : undefined,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  // E2E runs against a production build served by `vite preview` (no HMR reloads while agents edit files,
  // and it is what players get). Built fresh every run.
  webServer: {
    command: 'npx vite build --logLevel error && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
