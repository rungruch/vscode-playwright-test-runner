import { defineConfig } from '@playwright/test';

// Conventional non-default config name: this verifies automatic discovery of
// project layouts that split database and browser-only suites.
export default defineConfig({
  testDir: './tests',
  testMatch: 'no-db-only.spec.ts',
  reporter: 'line',
  workers: 2,
  projects: [{ name: 'browserless' }],
});
