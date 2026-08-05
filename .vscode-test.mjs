// @ts-check
import { defineConfig } from '@vscode/test-cli';

const officialExtension = 'ms-playwright.playwright@1.1.19';

const common = {
  installExtensions: [officialExtension],
  skipExtensionDependencies: true,
  mocha: {
    ui: 'tdd',
    timeout: 60000,
  },
};

export default defineConfig({
  tests: [
    {
      label: 'basicEarliestTestedHost',
      files: 'out/test/extension/basic.test.js',
      // Exercise the earliest maintained patch from the supported VS Code 1.125 line.
      version: '1.125.1',
      workspaceFolder: 'fixtures/basic',
      ...common,
    },
    {
      label: 'basicStableHost',
      files: 'out/test/extension/basic.test.js',
      // Full fixture coverage on the current stable VS Code release.
      version: '1.132.0',
      workspaceFolder: 'fixtures/basic',
      ...common,
    },
    {
      label: 'pw138EarliestTestedSmoke',
      files: 'out/test/extension/pw138.test.js',
      // Playwright 1.38.0 compatibility floor on the earliest tested host.
      version: '1.125.1',
      workspaceFolder: 'fixtures/pw138',
      ...common,
    },
    {
      label: 'multiRoot',
      files: 'out/test/extension/multiroot.test.js',
      // Nested configs across two workspace roots on the earliest tested host.
      version: '1.125.1',
      workspaceFolder: 'fixtures/multipkg/multi-root.code-workspace',
      ...common,
    },
  ],
});
