# Playwright CodeLens Runner

<p align="center">
  <img src="public/icon.png" width="128" alt="Playwright CodeLens Runner icon">
</p>

Run, debug, inspect, and open Playwright tests in UI mode directly from the editor line where each test is declared.

Playwright CodeLens Runner is a CodeLens companion to [Playwright Test for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright). Microsoft's official extension remains the only native test provider; this extension adds convenient CodeLens actions and carefully scoped Playwright CLI tools.

## CodeLens at a glance

```text
Run File · Debug File · Playwright UI

Run Suite · Debug Suite · Inspect Suite · Playwright UI
test.describe('checkout', () => {

  Run Test · Debug Test · Inspect Test · Playwright UI
  test('submits an order', async ({ page }) => {
```

| Action | Execution owner | Result location |
| --- | --- | --- |
| Run / Debug | Microsoft Playwright extension | VS Code Testing, gutter, output, duration, and debugger |
| Inspect | Playwright CodeLens Runner | Playwright Inspector and an integrated terminal |
| Playwright UI | Playwright CodeLens Runner | Playwright UI and an integrated terminal |

Run and Debug delegate to VS Code Testing, so editor actions update the same Microsoft-owned test results as the Testing view. Inspector and UI intentionally remain standalone CLI sessions and do not create duplicate native test runs.

## Why use it

- Run or debug a file, suite, or test without leaving the editor.
- Open an exact suite or test in Playwright Inspector or Playwright UI.
- Keep Microsoft as the sole `TestController`, avoiding duplicate execution and competing results.
- Discover nested suites, top-level tests, duplicate titles, and data-driven cases through Playwright itself.
- Collapse loop-generated cases at one source declaration into one CodeLens group.
- Work across multiple configs, workspace roots, and nested monorepo packages.
- Preserve config, working directory, environment, extra options, and paths containing spaces.
- Choose companion CLI projects independently from Microsoft's private project selection.

## Requirements

- VS Code 1.93 or newer
- [Playwright Test for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright), installed automatically as an extension dependency
- Node.js 20 or newer on the extension host
- `@playwright/test` 1.38 or newer in the workspace or a parent package root
- A trusted workspace, because Playwright discovery and CLI tools execute workspace configuration and test code

## Getting started

1. Install **Playwright CodeLens Runner**. VS Code also installs Microsoft's required Playwright extension.
2. Open a trusted workspace containing a Playwright config or test file.
3. Configure native projects and browsers in Microsoft's Testing view.
4. Open a `*.spec.*` or `*.test.*` file and use its CodeLens actions.
5. Optionally run **Playwright: Configure CLI Projects** for Inspector and Playwright UI.

Standard `playwright.config.{js,cjs,mjs,ts,cts,mts}` files are discovered automatically. Explicit configs, custom test patterns, configless workspaces, multi-root workspaces, and nested monorepos are also supported.

## Inspector browser

Inspector follows the Playwright config and configured CLI projects by default. To force one browser only for **Inspect Test/Suite**, set:

```json
{
  "playwrightCliRunner.inspector.browser": "firefox"
}
```

Available values are `config`, `chromium`, `firefox`, and `webkit`.

- `config` preserves Playwright config behavior and **Configure CLI Projects** selections.
- With named config projects, a forced browser selects the same-named project.
- When no projects are defined, the extension uses Playwright's `--browser` option.
- If projects use custom names, keep `config` and select them through **Configure CLI Projects**.

This setting affects Inspector only. It does not change Playwright UI or Microsoft-owned Run/Debug behavior.

## Project ownership

Microsoft's enabled configs and projects are private to the official extension and control native Run/Debug. Playwright CodeLens Runner never reads Microsoft internals.

**Configure CLI Projects** stores a separate project selection for Inspector and Playwright UI. This separation is intentional: changing companion CLI projects cannot silently alter the official Testing view.

## Commands

Open the Command Palette and search for **Playwright**:

- **Refresh Tests**
- **Configure CLI Projects**
- **Open Microsoft Playwright Settings**
- **Run Test** / **Debug Test**
- **Run All Tests in File** / **Debug All Tests in File**
- **Run Test with Playwright Inspector**
- **Open in Playwright UI**
- **Rerun Last Run**
- **Show HTML Report** / **Show Trace**
- **Record New Test (Codegen)**
- **Migrate Legacy Settings**

Refresh and Rerun delegate to VS Code Testing. Report, trace, codegen, Inspector, and UI use the resolved workspace Playwright CLI.

## Settings

The `playwrightCliRunner.*` namespace is retained for compatibility with the unreleased 2.0 rewrite and existing workspace configuration.

| Setting | Purpose | Default |
| --- | --- | --- |
| `playwrightCliRunner.configFiles` | Explicit discovery/CLI config paths; empty enables automatic discovery | `[]` |
| `playwrightCliRunner.cli.executable` | Explicit CLI executable such as `npx`, `pnpm`, or a local binary | automatic |
| `playwrightCliRunner.cli.arguments` | Arguments inserted before the Playwright subcommand | `[]` |
| `playwrightCliRunner.workingDirectory` | Companion CLI working directory | config directory |
| `playwrightCliRunner.runOptions` | Extra Inspector and Playwright UI options | `[]` |
| `playwrightCliRunner.inspector.browser` | Inspector browser/project override | `config` |
| `playwrightCliRunner.environment` | Environment for discovery and CLI processes | `{}` |
| `playwrightCliRunner.codeLens.enabled` | Enable editor actions | `true` |
| `playwrightCliRunner.codeLens.pattern` | Files receiving CodeLens actions | `**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}` |

Paths and environment values support `${workspaceFolder}`, `${packageRoot}`, and `${configDir}`. These companion settings do not override Microsoft's native Run/Debug configuration.

## Compatibility and migration

Version 2 can read former `playwrightrunner.*` settings when no equivalent new value is configured. Run **Playwright: Migrate Legacy Settings** to preview and copy supported settings into `playwrightCliRunner.*`.

Legacy Run and Debug command aliases delegate to Microsoft. Removed snapshot and JSON-import workflows show migration guidance instead of creating a second test controller.

The new marketplace identity is `rungruch.playwright-codelens-runner`. If an earlier development VSIX is installed under `rungruch.playwright-cli-test-runner`, uninstall it before installing this package.

## Development

```sh
npm ci
npm ci --prefix fixtures/basic
npm run typecheck
npm run lint
npm test
npm run package
npm run vsix
```

Extension-host tests run on VS Code 1.93.1 with `ms-playwright.playwright@1.1.19` and a browserless Playwright fixture.

## Thanks

This project began as a fork of [sakamoto66/vscode-playwright-test-runner](https://github.com/sakamoto66/vscode-playwright-test-runner). Thank you to Sakamoto and the original project's contributors for the foundation that made this rework possible.

## License

[MIT](LICENSE)
