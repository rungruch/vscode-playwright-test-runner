# Change Log

## 2.0.0 - 2026-08-05

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
