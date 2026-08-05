import { defineConfig } from '@playwright/test';

// Minimum supported Playwright release (1.38), browserless.
export default defineConfig({
  testDir: './tests',
  reporter: 'line',
  projects: [{ name: 'project-a' }],
});
