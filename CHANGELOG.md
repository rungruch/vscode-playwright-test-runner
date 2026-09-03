# Change Log

## 3.2.0 - 2026-09-02

- Keep a single global Playwright UI or Inspector terminal. Launching another interactive action now cancels the current session and starts the new request instead of reporting that the target is already running.
- Add `playwrightCodeLensRunner.sidebar.runsEnabled`. Disable it to hide the managed Runs dashboard and launch Flake Lab or failed-test rerun commands directly in an integrated terminal while retaining the Artifacts view.

## 3.1.0 - 2026-08-06

- Add companion-owned Flake Lab runs, changed/last-failed UI workflows, tag actions, remote UI profiles, and a Playwright Activity Bar view for local CLI summaries and artifacts. Native results remain owned by Microsoft Playwright Testing.

## 3.0.1 - 2026-08-06

- Automatically discover and live-refresh conventional variant Playwright configs such as `playwright.db.config.ts`, `playwright.no-db.config.ts`, and `playwright.pdf.config.ts`.
- Rename the Command Palette entry to **Select CLI Config for Current File** and document its persisted per-file companion CLI selection.
- Make config-picker filenames the primary label, with concise workspace-relative paths and discovery status as secondary context.
- Add extension-host coverage for variant config ownership and watcher-driven refresh.

## 3.0.0 - 2026-08-06

- Added `full`, `compact`, and `custom` CodeLens layouts with independently configurable file, suite, and test actions. CLI config selection and generated-case selection are first-class `config` and `cases` actions.
- Added fast file-scoped Playwright discovery with bounded concurrency, cancellable version probes, per-file caching, and portable, regex-safe file filters for discovery, Inspector, and UI.
- Added noninteractive ownership resolution for overlapping configs. Explicit CLI config choices are revalidated and persisted per file, cross-root and sibling `testDir` layouts are supported, and file-system changes refresh selected/discovered owners instead of relying on config-directory ancestry alone.
- Clarified generated-case scope: Microsoft-owned Run/Debug and direct companion Inspector/UI target the complete generated declaration, while **Cases (N)…** selects one exact Inspector/UI case using the declaration line plus file- and title-boundary-aware grep.
- Added editor discovery-failure lenses, a sanitized diagnostics channel, Details and Retry commands, and configured-Playwright-file/config fallback when those commands are invoked from the Command Palette.
- Added **More Playwright Actions…**, **Pick an Exact Generated Case**, and **Select CLI Config for File** commands.
- Forced discovery now re-probes the Playwright CLI version, allowing an upgraded installation to recover without reloading VS Code.
- Native file Run/Debug now dispatches its URI directly to Microsoft Testing without requiring companion CLI discovery or config selection.
- Workspace-scoped target identities prevent shared config paths from colliding in multi-root workspaces, and automatic config discovery no longer stops after 50 configs.
- Inspector/UI scopes combine declaration lines with exact title boundaries, preserving nested file paths, distinguishing flattened title collisions, and accepting Playwright tags attached to configs, `describe` blocks, and tests.
- Expanded unit and extension-host coverage for layouts, generated cases, safe discovery filters, sensitive diagnostics, sibling and overlapping configs, persisted ownership, refresh routing, and command registration.
- Kept Microsoft Playwright as the sole native TestController and retained the `{ discovery, projects, bridge }` extension API.

## 2.1.0 - 2026-08-06

- Released version 2.1 as a clean break from the original v1 runner.
- Renamed every command, setting, configuration listener, and persisted project key from `playwrightCliRunner.*` to `playwrightCodeLensRunner.*`. The marketplace identity remains `rungruch.playwright-codelens-runner`; no old aliases or state migration are provided.
- Removed all v1 compatibility: legacy command aliases and argument normalization, `playwrightrunner.*` setting fallbacks and the migration command, legacy variable aliases such as `${workspaceRoot}` and `${currentFile}`, and obsolete project-picker seeding.
- Removed stale repository content: old launch and task definitions tied to retired build tooling and the legacy scratch fixture; obsolete extension recommendations and ignored-state entries; unused basic-fixture specs; and the internal 2.0 rewrite diary. Pruned unused JSON-report model fields while retaining the active discovery parser.
- Raised requirements to VS Code `^1.125.0` on the extension host and Node.js `>=22.13.0` for contributors (Node.js 24 LTS recommended).
- Adopted TypeScript 7 as the primary compiler using Microsoft's documented side-by-side arrangement: `@typescript/native` aliases `typescript@^7.0.2` for `tsc`, while `typescript` aliases `@typescript/typescript6@^6.0.2` for compiler-API consumers and `tsc6`. Added `typecheck` (TypeScript 7) and `typecheck:ts6` (temporary parity) commands, explicit `node` and `mocha` types, `moduleResolution: "Bundler"`, and stable type ordering, while preserving CommonJS/ES2022 output for extension-runtime stability.
- Converted the build, test-host, and cleanup scripts to ESM and pointed launch configurations at the active basic fixture.
- Recommended ESLint and Microsoft's native TypeScript preview extension, configured for the local TypeScript 7 compiler.
- Losslessly resized the marketplace icon to 256×256 to satisfy VS Code guidance without changing its design.
- Applied stable dependency updates: VS Code types `1.125.0`, `@vscode/test-cli` `0.0.15`, `@vscode/test-electron` `3.1.0`, `@vscode/vsce` `3.9.2`, ESLint `10.8`, typescript-eslint `8.66`, esbuild `0.28`, Mocha `11.8`, and Knip `6.31`. Added `@eslint/js` as a direct dependency. Kept `@types/node` on 22 so declarations match the VS Code extension runtime.
- Updated maintained Playwright fixtures to `1.62.1`; kept the compatibility fixture pinned to `1.38.0`.
- Added permanent quality commands: zero-warning ESLint and `check:unused` via Knip with explicit extension, test, script, and fixture entries.
- Extension export remains `{ discovery, projects, bridge }`.
- Expanded the extension-host test matrix: full basic fixture on the earliest tested VS Code 1.125 patch (`1.125.1`) and current stable `1.132.0`, a Playwright `1.38.0` compatibility smoke test on that earliest tested host, and an automated multi-root test covering both nested configurations and their CodeLens discovery. The official Playwright extension remains pinned at `1.1.19` in tests.

## 2.0.0 - 2026-08-05

- Rebranded the independent 2.0 rewrite as **Playwright CodeLens Runner** with the marketplace identity `rungruch.playwright-codelens-runner`.
- Reworked the extension into a required CodeLens companion for `ms-playwright.playwright`.
- Delegated editor Run and Debug actions to VS Code Testing so Microsoft remains the sole TestController and owns status, output, duration, and debugging.
- Added default CodeLens actions for files, nested `test.describe` suites, top-level tests, and duplicate titles.
- Added exact file-, suite-, and test-scoped Playwright UI and Inspector CLI operations with separately persisted CLI project selection.
- Added multiple-config, multi-root workspace, monorepo, config, working-directory, environment, and extra-option support for discovery and companion CLI tools.
- Retained HTML report, trace, codegen, refresh, rerun, and settings migration commands; added a command to open Microsoft Playwright settings.
- Removed the duplicate runner, TestController, live reporter, JSON report import, snapshot workflow, additional reporters, and Testing-item context contributions.
- Changed the extension API to expose `{ discovery, projects, bridge }`.
- Added the `playwrightCliRunner.*` settings namespace and assisted migration from `playwrightrunner.*`.
- Raised requirements to VS Code 1.93, Node.js 20, and Playwright Test 1.38.
- Fixed Inspector, UI, report, trace, and codegen terminals launching the VS Code Electron helper without Node mode on macOS.
- Fixed Inspector/UI title filters for Playwright's project/file prefix, title separators, and trailing tags.
- Collapsed loop-generated and data-driven tests at one source declaration into a single CodeLens group, with Inspector/UI scoped by `file:line`.
- Placed CLI file filters before variadic project options so scoped Inspector/UI commands cannot be consumed as project names.
- Added an Inspector-only browser setting that defaults to config behavior and can force a matching Chromium, Firefox, or WebKit project.
- Fixed stale targets after settings changes, nested config routing, config creation/deletion, unsupported-version upgrades, duplicated project CodeLens entries, stale CLI projects, empty-setting precedence, custom-layout activation, and legacy string arguments.

## 1.4.1 - 2023-07-07

- Fix: #17 Fixed incorrect parsing of environment variables.


## 1.4.0 - 2022-11-14

- Feature: update inspector mode. Added --debug and --reporter=null to the inspector run options.
- Feature: add playwrightrunner.playwrightRunProject
- Feature: add playwrightrunner.playwrightDebugProject
- Feature: add playwrightrunner.playwrightInspectProject

## 1.3.0 - 2022-03-19

- Feature: supported "test.describe.parallel" "test.describe.only" "test.describe.serial.only" "test.describe.parallel.only".

## 1.2.1 - 2021-08-28

- Feature: Changed "playwright show-trace" from terminal startup to process startup.
- Feature: Changed "playwright codegen" from terminal startup to process startup.
- Feature: Changed the definition method of environment variables when starting the terminal.
- Fix: remove playwrightrunner.playwrightDebugOptions

## 1.1.0 - 2021-08-19

- Feature: add playwrightrunner.playwrightEnvironmentVariables
- Feature: remove playwrightrunner.playwrightDebugOptions
- Fix: Fixed an issue where command execution would fail if playwrightrunner.playwrightCommand was set.

## 1.0.0 - 2021-08-17

- Feature: supported codege form menue of explorer.
- Feature: supported "test.describe.serial".
- Feature: Changed the test case specification to a regular expression.
- Fix: Fixed an issue where multiple terminals would launch.

## 0.6.2 - 2021-08-14

- Feature: change terminal to debug console when run debug.
- Feature: remove setting value "playwrightrunner.playwrightPath"
- Feature: remove setting value "playwrightrunner.enableYarnPnpSupport"
- Feature: update Readme

## 0.5.2 - 2021-07-26

- Fix: faild when add option '--headed' on debug mode.

## 0.5.1 - 2021-07-21

- Fix: not show CodeLens on typescript(*.ts).

## 0.5.0 - 2021-07-21

- Fix: diseble jest mode. suported only playwright mode.

## 0.4.0 - 2021-07-11

- Feature: support show-trace command from menu of explorer(*.zip).
- Fix: show icon when status is timedOut on Test Report.

## 0.3.1 - 2021-07-09

- Fix: update README.md

## 0.3.0 - 2021-07-09

- Feature: update README.md
- Feature: support show playwright test report
- Feature: add shortcut menus on explorer for (*.ts,*.js,*.json)
- Fix: refactoring

## 0.2.2 - 2021-07-04

- Fix: rename inspector to inspect.

## 0.2.1 - 2021-07-03

- Feature: update README.md
- Fix: rename ${currentFileDir} -> ${currentFile}

## 0.2.0 - 2021-07-02

- Feature: refactor
- Feature: supported varibale ``${workspaceRoot}``,``${packageRoot}``,``${currentFile}``,``${fileExtname}``,``${fileBasenameNoExtension}``,``${fileBasename}``,``${fileDirname}``.
- Fix: bug
  
## 0.1.1 - 2021-06-29

- fix: Fixed an issue where playwrith options were not reflected.
- fix: rename inspector to inspect.
- fix: set set env:PWDEBUG=console shen debug mode.

## 0.1.0 - 2021-06-28

- Initial release
- fork firsttris/vscode-jest-runner version 0.4.44
- support playwright-test

---

The file format is based on [Keep a Changelog](http://keepachangelog.com/).
