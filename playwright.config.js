import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  // GitHub annotations keep assertion details available even when log/artifact storage is unreachable.
  reporter: [['list'], ['github']],
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure' }
});
