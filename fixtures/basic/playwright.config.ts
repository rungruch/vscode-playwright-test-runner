import { defineConfig } from '@playwright/test';

// Browserless fixture: tests only use expect/assertions, so no browser
// download is required to run them in CI.
export default defineConfig({
  testDir: './tests',
  reporter: 'line',
  workers: 2,
  projects: [{ name: 'browserless' }],
});
