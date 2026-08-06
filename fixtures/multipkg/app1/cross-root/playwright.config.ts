import { defineConfig } from '@playwright/test';

// A config in app1 intentionally owns tests in the app2 workspace root. This
// verifies that ownership comes from Playwright rather than workspace ancestry.
export default defineConfig({
  testDir: '../../app2/tests',
  reporter: 'line',
  projects: [{ name: 'cross-root-project' }],
});
