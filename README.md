# Playwright CLI Test Runner

Playwright UI and Inspector actions beside every test, plus convenient CodeLens Run and Debug actions backed by Microsoft's official Playwright extension.

This extension is a required companion to [Playwright Test for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright). Microsoft owns the Testing view, test status, output, duration, project/config selection, and debugger. This companion adds editor-first actions and scoped Playwright CLI tools without creating a second TestController or running a native test twice.

## Editor actions

Open a `*.spec.*` or `*.test.*` file and use the actions where you are already reading and writing tests:

```text
Run File · Debug File · Playwright UI

Run Suite · Debug Suite · Inspect Suite · Playwright UI
test.describe('checkout', () => {

  Run Test · Debug Test · Inspect Test · Playwright UI
  test('submits an order', async ({ page }) => {
```

The actions have two intentionally different owners:

| Action | Owner | Where results appear |
| --- | --- | --- |
| Run / Debug | Microsoft Playwright extension | VS Code Testing view, gutter, output, and debugger |
| Inspect | This companion runs `playwright test --debug` | Playwright Inspector and the companion terminal |
| Playwright UI | This companion runs `playwright test --ui` | Playwright UI and the companion terminal |

For suites and tests, Run/Debug temporarily opens the document, moves the caret to the CodeLens location, and delegates to VS Code's Testing command. The caret stays on that test so Microsoft's asynchronous discovery can resolve the intended item reliably.

## Features

- File-, suite-, and test-level Run and Debug CodeLens actions delegated to Microsoft
- Suite- and test-scoped Playwright Inspector and file-, suite-, and test-scoped Playwright UI
- Exact title filters for nested suites, top-level tests, and duplicate test titles
- Automatic local CLI and package-manager detection for discovery and companion CLI tools
- Multiple configs, multi-root workspaces, and monorepo working directories
- Separately persisted multi-select CLI projects for Inspector and Playwright UI
- HTML report, trace, and codegen commands
- Read-compatible migration from the former `playwrightrunner.*` settings

## Requirements

- VS Code 1.93 or newer
- [Microsoft Playwright extension](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright) (declared as an extension dependency)
- Node.js 20 or newer on the extension host
- `@playwright/test` 1.38 or newer in the workspace or a parent package root

The workspace must be trusted because Playwright loads configuration and test code during companion discovery and CLI operations.

## Getting started

1. Install this extension. VS Code also installs the required Microsoft Playwright extension.
2. Open a trusted workspace containing a Playwright config or test file.
3. Configure the official extension's enabled browsers, projects, and configs from the Testing view.
4. Open a test file and use the CodeLens actions.
5. Optionally run **Playwright: Configure CLI Projects** to restrict only Inspector and Playwright UI operations.

Config files named `playwright.config.{js,cjs,mjs,ts,cts,mts}` are discovered automatically. Configless projects are also supported. In a monorepo, each discovered config becomes a companion CLI target. Microsoft continues to own its own configuration and project selection; this extension never reads Microsoft's private storage or extension internals.

## Commands

Use the Command Palette and search for **Playwright**:

- **Refresh Tests** — refreshes Microsoft Testing and companion CodeLens discovery
- **Configure CLI Projects** — selects projects only for Inspector and Playwright UI
- **Open Microsoft Playwright Settings**
- **Run Test** / **Debug Test** / **Run All Tests in File** / **Debug All Tests in File**
- **Run Test with Playwright Inspector**
- **Open in Playwright UI**
- **Rerun Last Run** — delegates to VS Code Testing
- **Show HTML Report** / **Show Trace**
- **Record New Test (Codegen)**
- **Migrate Legacy Settings**

Snapshot updates and JSON report imports are no longer supplied by this companion. Use the official extension's snapshot configuration and native Testing workflow instead.

## Settings

| Setting | Purpose | Default |
| --- | --- | --- |
| `playwrightCliRunner.configFiles` | Explicit companion discovery/CLI config paths; empty enables automatic discovery | `[]` |
| `playwrightCliRunner.cli.executable` | Explicit CLI executable such as `npx`, `pnpm`, or a local binary | automatic |
| `playwrightCliRunner.cli.arguments` | Arguments inserted before the Playwright subcommand | `[]` |
| `playwrightCliRunner.workingDirectory` | Companion CLI working directory | config directory |
| `playwrightCliRunner.runOptions` | Extra Inspector and Playwright UI options | `[]` |
| `playwrightCliRunner.environment` | Environment for discovery and companion CLI processes | `{}` |
| `playwrightCliRunner.codeLens.enabled` | Editor Run, Debug, Inspect, and UI actions | `true` |
| `playwrightCliRunner.codeLens.pattern` | Files that receive editor actions | `**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}` |

Paths and environment values support `${workspaceFolder}`, `${packageRoot}`, and `${configDir}`. These settings do not override the official extension's Run/Debug configuration.

## Migrating from 1.x

Version 2 reads existing `playwrightrunner.*` settings when no equivalent new setting is explicitly configured. Run **Playwright: Migrate Legacy Settings** to copy supported values into the `playwrightCliRunner.*` namespace, review the preview, and remove the old entries when convenient.

Legacy Run and Debug command IDs delegate to Microsoft. Removed snapshot-related aliases show a migration notice instead of starting a duplicate runner.

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

Extension-host tests run against VS Code 1.93.1 with `ms-playwright.playwright@1.1.19` and a one-project browserless fixture.

## License

[MIT](LICENSE)
