# Playwright CodeLens Runner

<p align="center">
  <img src="public/icon.png" width="128" alt="Playwright CodeLens Runner icon">
</p>

Browse every Playwright test in Test Explorer, or run, debug, inspect, and open tests in UI mode from the editor line where each test is declared.

Version 4.2 unifies Run actions with a configurable backend and makes companion CLI runs the default. Choose Microsoft's Playwright extension through `run.backend`; Debug continues using Microsoft Testing.

Playwright CodeLens Runner is a CodeLens companion to [Playwright Test for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright). Microsoft's official extension remains the only native test provider; this extension adds convenient CodeLens actions and carefully scoped Playwright CLI tools.

## Test Explorer

Open the **Playwright** Activity Bar icon to see **Test Explorer** with live run results, a **Run History & Sessions** group, and a separate Artifacts view. Tests load automatically across all Playwright configs and workspace roots, without opening their source files. Under each config, expand folders to browse the project's directory structure, then files, nested suites, and individual tests. Files show their filenames; folders follow paths relative to the workspace root. Folders and files share alphabetical order. Click a file, suite, or test to open its source; use its inline **Run** or **Debug** action to execute it.

Discovery uses Playwright itself, including custom test patterns and loop-generated cases. Project names, tags, and skipped status appear in tooltips. All discovered projects are listed independently of the projects selected for execution. Configless projects are scanned when a Playwright Test dependency is declared or locally installed, or when a custom CLI is configured.

**Run** follows `playwrightCodeLensRunner.run.backend` and defaults to the companion runner, with results directly on the tests in **Test Explorer**. **Debug** uses Microsoft's extension and VS Code Testing. Each generated case is listed separately: companion Run selects the exact case, while **Run Declaration** (with the official backend) and **Debug Declaration** target the cases at its shared source declaration. Microsoft actions use Microsoft's configured projects and config selection.

Saved edits, file creation/deletion, config changes, and configured fixture/data watch patterns refresh the inventory automatically. The previous tree remains visible while refreshing; outdated entries cannot run until discovery succeeds. Failures show **Retry Discovery** and **Discovery Details** under the affected config. Use the view's **Refresh** and **Collapse All** controls, or **Playwright: Open Test Explorer** from Command Palette. Navigation remains available on retained rows after discovery failures.

## CodeLens at a glance

```text
Run File · Debug File · Playwright UI · CLI Config: playwright.config.ts · More…

Run Suite · Debug Suite · Inspect Suite · Playwright UI · More…
test.describe('checkout', () => {

  Run Test · Debug Test · Inspect Test · Playwright UI · More…
  test('submits an order', async ({ page }) => {
```

The CodeLens workbench supports four layouts:

- `full` keeps the complete action sets. Files also show the resolved **CLI Config**, and generated tests show **Cases (N)…**.
- `compact` shows `Run · Debug · More…`; CLI config selection, Inspector/UI, and generated cases remain available inside **More…**.
- `companion-only` shows Run, Inspect, Playwright UI, and Flake Lab without Debug. Run still follows the selected backend.
- `custom` uses separate `codeLens.fileActions`, `codeLens.suiteActions`, and `codeLens.testActions` arrays. The file-only `config` action and generated-test-only `cases` action are configurable too.

For example:

```json
{
  "playwrightCodeLensRunner.codeLens.layout": "custom",
  "playwrightCodeLensRunner.codeLens.fileActions": ["run", "debug", "config", "more"],
  "playwrightCodeLensRunner.codeLens.suiteActions": ["run", "inspect", "ui"],
  "playwrightCodeLensRunner.codeLens.testActions": ["run", "debug", "inspect", "cases", "more"]
}
```

**Run uses the companion CLI runner by default**, with live CodeLens status and results in **Test Explorer**. Choose Microsoft's Playwright extension for Run instead with:

```json
{
  "playwrightCodeLensRunner.run.backend": "official"
}
```

The setting accepts `companion` (default) or `official`, can be configured per workspace folder, and applies immediately to CodeLens, **More…**, Command Palette Run commands, and the editor Run File button. **Debug** always uses Microsoft’s extension. Existing custom `companionRun` CodeLens entries become aliases for `run`; including both produces one Run action using the selected backend.

Loop-generated tests remain one declaration. Run with either backend, Microsoft Debug, and the declaration's direct Inspector/UI actions target all generated cases at that source line. **Cases (N)…** lets you choose one exact case for Inspector or UI, combining the declaration line with file- and title-boundary-aware filtering.

| Action | Execution owner | Result location |
| --- | --- | --- |
| Run (default) | Playwright CodeLens Runner | Test Explorer, live CodeLens status, and colored CLI output |
| Run (`official`) / Debug | Microsoft Playwright extension | VS Code Testing, gutter, output, duration, and debugger |
| Inspect | Playwright CodeLens Runner | Playwright Inspector and an integrated terminal |
| Playwright UI | Playwright CodeLens Runner | Playwright UI and an integrated terminal |

## Companion Runs, Flake Lab, and sidebar dashboard

**Run Companion Test (Normal CLI Run)** explicitly uses the companion backend regardless of `run.backend` and remains available through Command Palette (`playwrightCodeLensRunner.runCompanion`). It runs tests with target-scoped arguments without native VS Code test run duplication and without Flake Lab's repeating overhead.

**Flake Lab** is a companion CLI run for the current file, suite, test, or generated-case declaration. It deliberately does not create a native VS Code test run. By default it uses `--repeat-each 10`, `--workers 1`, `--retries 1`, `--trace on`, and `--fail-on-flaky-tests`; the last flag requires Playwright Test 1.52 or later.

The **Test Explorer** shows running, passed, failed, flaky, and skipped icons on tests, with durations and aggregate status on their files, suites, and folders. A summary above the tree shows current progress or the last result. Hover a failed test for its error, or use **Show Test Run Output** to open its colored output. A narrow rerun preserves other tests’ results while their runs remain in history. Expand **Run History & Sessions** below the test inventory for retained summaries, totals, failures, and active UI/report sessions. Concurrent runs show completed and active counts (for example, `3/10 completed · 5 running`), while each finished test receives its result immediately without changing the status of tests that are still running. Flake Lab keeps one row per source test and aggregates its repetitions into live completed/running counts and final clean, flaky, failed, or skipped outcomes. The explorer toolbar provides **Stop**, **Rerun Failed**, and **Show Companion Output**. Its menu includes Flake Lab, Clear History, and Microsoft Testing. Set `playwrightCodeLensRunner.sidebar.runsEnabled` to `false` to hide managed result decorations and history and launch Companion runs, Flake Lab, or cached failed-test reruns directly in an integrated terminal instead. The test inventory remains available. Terminal-only runs use the generated Playwright arguments without the managed reporters or summary updates; the Artifacts view remains available.

Live reporter events are processed in order and published to CodeLens and the sidebar in batches of up to 100 ms. Run start and final results publish immediately. Concurrent runs keep their launch order, and clearing history retains active runs and their cancellation controls. The history-size setting limits completed runs.

The companion’s **More…** menu also provides changed and last-failed Playwright UI launches, discovered-tag actions, UI profiles, and Artifact Center. **Open Changed Tests in Playwright UI** uses `--only-changed` for uncommitted changes by default or a supplied Git ref; **Open Last Failed Tests in Playwright UI** uses Playwright’s persisted last-run data. These are target-scoped: they preserve the resolved config and selected companion projects without adding the current test title filter.

Tag actions use discovered `@tags` and structured `--grep @tag` arguments for UI, Inspector, and copied terminal commands. The extension keeps one global UI/Inspector terminal: launching any new interactive action cancels the current Playwright UI or Inspector session before starting the requested target or profile.

### Artifacts and remote UI

The **Playwright Artifacts** view scans only configured target directories and the local `playwright-report`, `blob-report`, and `test-results` roots by default. It ranks HTML reports, report ZIPs, traces, blob-report ZIPs, and test-result attachments newest-first. Open or reveal artifacts from the view, merge blob reports with `playwright merge-reports --reporter html`, and reopen the generated report.

Configs sharing artifact roots share one scan. Opening a shared report or trace asks which CLI config to use. Each history row’s **View CLI Output** opens that run’s retained output tail (up to 24,000 characters) in a read-only terminal. Live output preserves Playwright’s colors, assertion diffs, and highlighted code frames, with one stable line per completed test. Concurrent runs have separate output terminals; reopening a terminal resumes that run’s output. **Show Companion Output** opens the latest run. `companion.showCliOutput` controls automatic opening (`on-run`, `on-failure`, or `never`); closing the output terminal does not cancel the run—use **Stop** in Test Explorer.

Remote UI profiles add `--ui-host` and `--ui-port` safely as CLI arguments:

```json
{
  "playwrightCodeLensRunner.ui.profiles": [
    { "name": "Codespaces", "host": "0.0.0.0", "port": 8080 }
  ],
  "playwrightCodeLensRunner.ui.defaultProfile": "Codespaces"
}
```

Non-loopback profiles display a network-exposure warning before launch. The extension focuses Test Explorer after companion actions and Microsoft Testing after native Run/Debug by default; set `playwrightCodeLensRunner.sidebar.autoFocus` to `false` to opt out. View placement remains entirely under VS Code and user control.

Run and Debug delegate to VS Code Testing, so editor actions update the same Microsoft-owned test results as the Testing view. Inspector and UI intentionally remain standalone CLI sessions and do not create duplicate native test runs.

## Why use it

- Run or debug a file, suite, or test without leaving the editor.
- Open an exact suite or test in Playwright Inspector or Playwright UI.
- Keep Microsoft as the sole `TestController`, avoiding duplicate execution and competing results.
- Discover nested suites, top-level tests, duplicate titles, and data-driven cases through Playwright itself.
- Collapse loop-generated cases at one source declaration into one CodeLens group.
- Select one exact generated case for Inspector or Playwright UI without changing native Run/Debug scope.
- Work across multiple configs, workspace roots, cross-root `testDir` ownership, and nested monorepo packages.
- Show discovery failures in the editor with Details, Retry, and CLI-config recovery actions.
- Resolve overlapping CLI config ownership without interrupting CodeLens calculation, remember explicit choices per file, and display the active CLI config in the file lens.
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
3. Open **Playwright → Test Explorer** to browse all tests, then click **Run** or **Debug** beside a file, suite, or test.
4. Configure native projects and browsers in Microsoft's Testing view, or use **Playwright: Configure CLI Projects** for companion runs, Inspector, and Playwright UI.
5. Open a test file to use its CodeLens actions directly in the editor.

Conventional `playwright*.config.{js,cjs,mjs,ts,cts,mts}` files are discovered automatically, including variants such as `playwright.no-db.config.ts` and `playwright.pdf.config.ts`. For any other filename, list it explicitly in `playwrightCodeLensRunner.configFiles`. Custom test patterns, configless workspaces, multi-root workspaces, and nested monorepos are also supported.

Companion discovery, Inspector, and UI use cwd-relative paths when possible, otherwise absolute paths, then forward-slash-normalize and regex-escape Playwright's positional file filter. This keeps every CLI action reliable for filenames containing spaces or regular-expression metacharacters and for Windows-style paths.

Suite and test Inspector/UI actions combine that file filter with the declaration's source line and an exact title-path filter. The line scope distinguishes title paths that Playwright flattens to the same text, while the title filter accepts project prefixes, nested-file paths, separators, and inherited tags.

## Inspector browser

The top-level `playwrightCodeLensRunner.browser` supplies the default for companion modes. Each mode's explicit browser setting overrides only that mode, including `config` to preserve config projects instead of the top-level override. An unset mode setting inherits the top-level default.

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

With `codeLens.fastStaticDiscovery` enabled (the default), CodeLens renders source-based actions before CLI ownership discovery finishes. Parsed declarations are cached by document version. Background CLI discovery supplies the verified config, projects, and generated cases; unsaved edits keep their current source positions. Disable this setting to wait for CLI verification before rendering actions.

Static discovery recognizes aliases imported from `@playwright/test` or local fixture modules, namespace imports, and extended or merged fixtures. Imported Jest declarations are excluded. Files without a Playwright config or recognized imports require `codeLens.allowUnverifiedTests: true` for provisional unbound `test`/`it`/`describe` wrappers; companion execution still verifies CLI ownership.

Companion Run, Flake Lab, Inspector, and scoped Playwright UI actions save the selected test document before verifying its declaration and launching. Failed-test reruns save their selected test files. If saving fails, the selection disappears, or the source changes during preparation, the action stops with a message to retry the current selection. Native Run and Debug remain owned by Microsoft Testing.

The **CLI Config** file lens is also companion-only. Its initial target can be provisional. Background discovery resolves ownership noninteractively: it revalidates a remembered choice, otherwise selects a deterministic config whose Playwright discovery owns the file. Use **Select CLI Config for File** to choose another overlapping config and remember it for that file. Configs may own sibling directories or tests in another workspace root; they do not need to be ancestors of the test file.

Saved and externally changed test files invalidate affected targets’ test data, retain CLI-version metadata, and refresh changed or visible files after a short debounce. Full inventories are rebuilt for explicit refreshes, config changes, or commands that need them. Known persisted or discovered owners are refreshed together, including sibling and cross-root layouts. File discovery retains open documents and up to 128 inactive entries per target; explicit Retry rechecks the CLI version.

For imported fixtures, helpers, or generated-case data, set narrow workspace-relative `discovery.watchPatterns`, for example `["tests/fixtures/**/*.ts", "test-data/**/*.json"]`. Matching saves and external creates, changes, or deletes invalidate discovery and rebuild all config inventories after the debounce, retaining CLI version metadata. Patterns default to `[]` so large repositories control this extra work.

Failed reruns preserve each verified source location and exact title. Ordinary declarations share one CLI scope; generated declarations use separate scopes within one managed run to keep each declaration's case filters local. Indistinguishable generated cases display a message explaining how to narrow the test source. With managed runs disabled, each scope opens a separate terminal. CLI terminals launch through a bundled argv relay; copied commands on Windows use PowerShell syntax.

## Commands

Open the Command Palette and search for **Playwright**:

- **Refresh Tests**
- **Configure CLI Projects**
- **Open Microsoft Playwright Settings**
- **Run Test** / **Debug Test**
- **Run All Tests in File** / **Debug All Tests in File**
- **Run Test with Playwright Inspector**
- **Open in Playwright UI**
- **More Playwright Actions…** / **Pick an Exact Generated Case**
- **Show Playwright Discovery Details** / **Retry Playwright Discovery**
- **Select CLI Config for Current File** — run this from Command Palette (`Cmd+Shift+P`) to choose and remember the companion CLI config for the active file
- **Rerun Last Run**
- **Run Flake Lab** / **Rerun Failed Companion Tests**
- **Open Changed Tests in Playwright UI** / **Open Last Failed Tests in Playwright UI**
- **Tag Actions…** / **Open Playwright UI Profile…**
- **Open Playwright Run History** / **Open Playwright Artifact Center**
- **Open Latest Playwright Report** / **Open Latest Playwright Trace** / **Merge Playwright Blob Reports**
- **Show HTML Report** / **Show Trace**
- **Record New Test (Codegen)**

Refresh and Rerun delegate to VS Code Testing. Report, trace, codegen, Inspector, and UI use the resolved workspace Playwright CLI.

Discovery Details and Retry preserve file scope only when the active document matches `playwrightCodeLensRunner.codeLens.pattern`; otherwise they ask for a CLI config. Diagnostics include scope, config, working directory, CLI version, projects, duration, and a shell-quoted command preview; sensitive option values and configured environment values are redacted.

## Settings

All commands and settings live in the `playwrightCodeLensRunner.*` namespace. Version 3.3 continues the clean break from earlier `playwrightrunner.*` and `playwrightCliRunner.*` identifiers: they are no longer read, aliased, or migrated. Update any workspace configuration to the namespace below.

| Setting | Purpose | Default |
| --- | --- | --- |
| `playwrightCodeLensRunner.configFiles` | Explicit discovery/CLI config paths; empty discovers conventional `playwright*.config.*` files | `[]` |
| `playwrightCodeLensRunner.discovery.watchPatterns` | Additional imported helper, fixture, or data globs that rebuild inventories | `[]` |
| `playwrightCodeLensRunner.codeLens.allowUnverifiedTests` | Provisional unbound wrappers without config/import evidence | `false` |
| `playwrightCodeLensRunner.cli.executable` | Explicit CLI executable such as `npx`, `pnpm`, or a local binary | automatic |
| `playwrightCodeLensRunner.cli.arguments` | Arguments inserted before the Playwright subcommand | `[]` |
| `playwrightCodeLensRunner.workingDirectory` | Companion CLI working directory | config directory |
| `playwrightCodeLensRunner.runOptions` | Extra Inspector and Playwright UI options | `[]` |
| `playwrightCodeLensRunner.inspector.browser` | Inspector browser/project override | `config` |
| `playwrightCodeLensRunner.browser` | Default browser for companion modes | `config` |
| `playwrightCodeLensRunner.run.backend` | Backend for unified Run: `companion` or `official`; Debug stays Microsoft | `companion` |
| `playwrightCodeLensRunner.companion.browser` | Companion Run browser override; explicit `config` opts out of the default | inherits `browser` |
| `playwrightCodeLensRunner.flakeLab.browser` | Flake Lab browser override; explicit `config` opts out of the default | inherits `browser` |
| `playwrightCodeLensRunner.environment` | Environment for discovery and CLI processes | `{}` |
| `playwrightCodeLensRunner.flakeLab.repeatEach` | Repetitions for companion Flake Lab runs | `10` |
| `playwrightCodeLensRunner.flakeLab.workers` | Workers for companion Flake Lab runs | `1` |
| `playwrightCodeLensRunner.flakeLab.retries` | Flake Lab retry count (`0`–`5`) | `1` |
| `playwrightCodeLensRunner.flakeLab.trace` | Trace mode for Flake Lab | `on` |
| `playwrightCodeLensRunner.flakeLab.failOnFlakyTests` | Fail a Flake Lab run when a retry recovers | `true` |
| `playwrightCodeLensRunner.ui.profiles` | Named remote UI host/port profiles | `[]` |
| `playwrightCodeLensRunner.ui.defaultProfile` | Profile used for normal UI actions | empty |
| `playwrightCodeLensRunner.sidebar.autoFocus` | Focus the action owner’s view | `true` |
| `playwrightCodeLensRunner.sidebar.runsEnabled` | Show live results and history in Test Explorer; disable for terminal-only execution | `true` |
| `playwrightCodeLensRunner.artifacts.scanDirectories` | Local artifact roots per target | `playwright-report`, `blob-report`, `test-results` |
| `playwrightCodeLensRunner.codeLens.enabled` | Enable editor actions | `true` |
| `playwrightCodeLensRunner.codeLens.pattern` | Files receiving CodeLens actions | `**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}` |
| `playwrightCodeLensRunner.codeLens.layout` | `full`, `compact`, `companion-only`, or `custom` CodeLens layout | `full` |
| `playwrightCodeLensRunner.codeLens.fileActions` | Custom file actions: `run`, `debug`, `ui`, `config`, `more` | `run`, `debug`, `ui`, `config` |
| `playwrightCodeLensRunner.codeLens.suiteActions` | Custom actions for suite lenses | `run`, `debug`, `inspect`, `ui` |
| `playwrightCodeLensRunner.codeLens.testActions` | Custom test actions, including generated-only `cases` | `run`, `debug`, `inspect`, `ui`, `cases` |

Paths and environment values support `${workspaceFolder}`, `${packageRoot}`, and `${configDir}`. Companion CLI options apply when Run uses the companion backend; Microsoft's native Run/Debug options remain owned by its extension.

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
npm run test:reporter  # Reporter compatibility against supported Playwright fixtures
npm run benchmark:core # Warmed median timings for 250, 1,000, and 2,000 tests
npm run benchmark:explorer # Compare live result projection against its frozen baseline
npm test
npm run package
npm run vsix
```

### GitHub releases

Push a `v`-prefixed tag matching the `package.json` version (for example, `v4.0.0`). The release workflow runs the test suite, builds the VSIX, and attaches it to a GitHub Release with generated release notes.

The core benchmark is separate from unit-test gates. It measures reporter planning, all test-status lookups (including index construction), final-report reconciliation, and generated cases sharing one source declaration using three warmup runs and seven measured runs. Compare results on the same machine; real workspace discovery also depends on Playwright and test configuration.

The [Test Explorer benchmark](benchmarks/explorer-results.md) compares the current result projector against a frozen copy of its previous implementation, with 1,000, 10,000, and 30,000 tests. It measures cold projection, changing live snapshots, narrow reruns, replacement inventories, and empty history. Every snapshot's complete result map must match the baseline. To capture medians, p95 timings, raw samples, and machine details, run `npm run benchmark:explorer -- --output benchmarks/explorer-results.json`.

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
| Multi-root ownership and discovery | Earliest tested VS Code 1.125 patch (`1.125.1`) | `fixtures/multipkg` with overlapping, sibling-`testDir`, and cross-root configs (Playwright `1.62.1`) |

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
