import { defineConfig } from '@playwright/test';

// This nested config intentionally owns a sibling test directory. It exercises
// ownership resolution by Playwright discovery rather than config-directory
// ancestry, and overlaps with app1's root config.
export default defineConfig({
  testDir: '../tests',
  reporter: 'line',
  projects: [{ name: 'app1-nested-project' }],
});
