import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure' }
});
