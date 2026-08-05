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

- VS Code 1.125 or newer on the extension host
- [Playwright Test for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright), installed automatically as an extension dependency. This extension is validated against the latest published official release, `1.1.19`, and remains pinned to it in the test matrix.
- Node.js 22.13 or newer for contributors; Node.js 24 LTS is recommended. The extension host runtime itself is provided by VS Code.
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
  "playwrightCodeLensRunner.inspector.browser": "firefox"
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

Refresh and Rerun delegate to VS Code Testing. Report, trace, codegen, Inspector, and UI use the resolved workspace Playwright CLI.

## Settings

All commands and settings live in the `playwrightCodeLensRunner.*` namespace. Version 2.1 is a clean break: earlier `playwrightrunner.*` and `playwrightCliRunner.*` identifiers are no longer read, aliased, or migrated. Update any workspace configuration to the namespace below.

| Setting | Purpose | Default |
| --- | --- | --- |
| `playwrightCodeLensRunner.configFiles` | Explicit discovery/CLI config paths; empty enables automatic discovery | `[]` |
| `playwrightCodeLensRunner.cli.executable` | Explicit CLI executable such as `npx`, `pnpm`, or a local binary | automatic |
| `playwrightCodeLensRunner.cli.arguments` | Arguments inserted before the Playwright subcommand | `[]` |
| `playwrightCodeLensRunner.workingDirectory` | Companion CLI working directory | config directory |
| `playwrightCodeLensRunner.runOptions` | Extra Inspector and Playwright UI options | `[]` |
| `playwrightCodeLensRunner.inspector.browser` | Inspector browser/project override | `config` |
| `playwrightCodeLensRunner.environment` | Environment for discovery and CLI processes | `{}` |
| `playwrightCodeLensRunner.codeLens.enabled` | Enable editor actions | `true` |
| `playwrightCodeLensRunner.codeLens.pattern` | Files receiving CodeLens actions | `**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}` |

Paths and environment values support `${workspaceFolder}`, `${packageRoot}`, and `${configDir}`. These companion settings do not override Microsoft's native Run/Debug configuration.

## Marketplace identity

The marketplace identity is `rungruch.playwright-codelens-runner`. If an earlier development VSIX is installed under `rungruch.playwright-cli-test-runner`, uninstall it before installing this package.

## Development

Contributors need Node.js 22.13 or newer (Node.js 24 LTS recommended).

```sh
npm ci
npm run test:fixture
npm run typecheck      # TypeScript 7
npm run typecheck:ts6  # TypeScript 6 parity (temporary)
npm run lint           # ESLint, zero warnings allowed
npm run check:unused   # Knip
npm test
npm run package
npm run vsix
```

### TypeScript 7 and TypeScript 6 side by side

[TypeScript 7 does not yet expose the compiler API](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) that tools such as typescript-eslint require. The repository therefore follows Microsoft's documented side-by-side arrangement: native TypeScript 7 is the primary compiler for builds and type-checking, while TypeScript 6 is available only for tooling compatibility.

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

`npm run typecheck` resolves `tsc` from TypeScript 7. `npm run typecheck:ts6` runs `tsc6` from the compatibility package as a temporary parity gate. TypeScript 6 can be removed once typescript-eslint supports native TypeScript 7.

### Test matrix

Extension-host tests install `ms-playwright.playwright@1.1.19` and run against browserless fixtures:

| Suite | Host | Fixture |
| --- | --- | --- |
| Full basic fixture | Earliest tested VS Code 1.125 patch (`1.125.1`) | `fixtures/basic` (Playwright `1.62.1`) |
| Full basic fixture | Current stable VS Code `1.132.0` | `fixtures/basic` (Playwright `1.62.1`) |
| Playwright compatibility smoke | Earliest tested VS Code 1.125 patch (`1.125.1`) | `fixtures/pw138` (Playwright `1.38.0`) |
| Multi-root nested discovery | Earliest tested VS Code 1.125 patch (`1.125.1`) | `fixtures/multipkg` (Playwright `1.62.1`) |

Playwright `1.38.0` remains the supported minimum despite newer maintained fixtures. The official Playwright extension remains pinned at its latest published release, `1.1.19`, in these tests.

### Intentional dependency pins

`npx --package npm-check-updates ncu` is rerun after upgrades. The following pins are deliberate rather than stale:

- `@types/node` stays on 22 so declarations match the VS Code extension host runtime, not the latest major (26).
- `@types/vscode` matches the declared engine floor (`1.125.0`).
- `typescript` aliases TypeScript 6 solely for the compiler API; `@typescript/native` aliases TypeScript 7 for `tsc`.
- `fixtures/pw138` keeps `@playwright/test` pinned to `1.38.0` to exercise the compatibility floor.

## Thanks

This project began as a fork of [sakamoto66/vscode-playwright-test-runner](https://github.com/sakamoto66/vscode-playwright-test-runner). Thank you to Sakamoto and the original project's contributors for the foundation that made this rework possible.

## License

[MIT](LICENSE)
