// @ts-check
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  tests: [
    {
      label: 'extensionTests',
      files: 'out/test/extension/**/*.test.js',
      // Exercise the declared compatibility floor and avoid future stable
      // application-layout changes breaking this extension's test harness.
      version: '1.93.1',
      workspaceFolder: 'fixtures/basic',
      installExtensions: ['ms-playwright.playwright@1.1.19'],
      skipExtensionDependencies: true,
      mocha: {
        ui: 'tdd',
        timeout: 60000,
      },
    },
  ],
});
