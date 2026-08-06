import { defineConfig } from '@playwright/test';

// This config overlaps app1's root config and is the deepest filesystem
// ancestor of app1.spec.ts. Tests persist the root config to verify that save
// refresh follows ownership rather than blindly choosing this deepest config.
export default defineConfig({
  testDir: '.',
  reporter: 'line',
  projects: [{ name: 'app1-deep-project' }],
});
