import * as vscode from 'vscode';
import { UiProfile } from './core/companionTypes';
import { normalizeUiProfiles } from './core/uiProfiles';
import { BrowserPreference, isBrowserPreference } from './core/inspectorBrowser';
import { FlakeLabSizePreset, resolveFlakeLabRepeatEach } from './core/runArguments';

/** Public configuration namespace for the extension. */
export const SETTINGS_NAMESPACE = 'playwrightCodeLensRunner';

const DEFAULT_CODE_LENS_PATTERN = '**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}';

export type CodeLensLayout = 'full' | 'compact' | 'custom';
export type CodeLensAction = 'run' | 'debug' | 'inspect' | 'ui' | 'config' | 'cases' | 'more';
export type CompanionShowCliOutput = 'on-run' | 'on-failure' | 'never';
export type InspectorBrowser = BrowserPreference;
export { FlakeLabSizePreset };

const ACTIONS_BY_KIND: Record<'file' | 'suite' | 'test', readonly CodeLensAction[]> = {
  file: ['run', 'debug', 'ui', 'config', 'more'],
  suite: ['run', 'debug', 'inspect', 'ui', 'more'],
  test: ['run', 'debug', 'inspect', 'ui', 'cases', 'more'],
};
const FULL_FILE_ACTIONS: readonly CodeLensAction[] = ['run', 'debug', 'ui', 'config', 'more'];
const FULL_SUITE_ACTIONS: readonly CodeLensAction[] = ['run', 'debug', 'inspect', 'ui', 'more'];
const FULL_TEST_ACTIONS: readonly CodeLensAction[] = ['run', 'debug', 'inspect', 'ui', 'cases', 'more'];
const COMPACT_ACTIONS: readonly CodeLensAction[] = ['run', 'debug', 'more'];

/**
 * Reads `playwrightCodeLensRunner.*` settings. Empty strings, arrays and
 * objects resolve to automatic detection or documented defaults.
 */
export class Settings {
  constructor(private readonly resource?: vscode.Uri) {}

  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(SETTINGS_NAMESPACE, this.resource);
  }

  /** Explicit config file list, or undefined for automatic discovery. */
  get configFiles(): string[] | undefined {
    const files = this.configuration().get<string[]>('configFiles', []);
    return files.length > 0 ? files : undefined;
  }

  get cliExecutable(): string | undefined {
    const executable = this.configuration().get<string>('cli.executable', '');
    return executable.trim().length > 0 ? executable : undefined;
  }

  get cliArguments(): string[] {
    return this.configuration().get<string[]>('cli.arguments', []);
  }

  /** Working directory override, or undefined for the config directory. */
  get workingDirectory(): string | undefined {
    const directory = this.configuration().get<string>('workingDirectory', '');
    return directory.trim().length > 0 ? directory : undefined;
  }

  get runOptions(): string[] {
    return this.configuration().get<string[]>('runOptions', []);
  }

  /**
   * Top-level browser preference for all Playwright runs (companion CLI, Flake Lab, Inspector).
   * Also checks legacy `playwrightrunner.playwrightRunProject` if set to a supported browser.
   */
  get browser(): BrowserPreference {
    const value = this.configuration().get<string>('browser', 'config');
    if (isBrowserPreference(value) && value !== 'config') {
      return value;
    }
    const legacy = vscode.workspace.getConfiguration('playwrightrunner', this.resource).get<string>('playwrightRunProject', '');
    if (isBrowserPreference(legacy) && legacy !== 'config') {
      return legacy;
    }
    return 'config';
  }

  /** Browser/project override applied to Playwright Inspector commands. */
  get inspectorBrowser(): InspectorBrowser {
    const value = this.configuration().get<string>('inspector.browser', 'config');
    if (isBrowserPreference(value) && value !== 'config') {
      return value;
    }
    if (this.browser !== 'config') {
      return this.browser;
    }
    const companion = this.configuration().get<string>('companion.browser', 'config');
    if (isBrowserPreference(companion) && companion !== 'config') {
      return companion;
    }
    const flake = this.configuration().get<string>('flakeLab.browser', 'config');
    if (isBrowserPreference(flake) && flake !== 'config') {
      return flake;
    }
    return 'config';
  }

  get companionShowCliOutput(): CompanionShowCliOutput {
    const value = this.configuration().get<string>('companion.showCliOutput', 'on-run');
    return value === 'on-failure' || value === 'never' ? value : 'on-run';
  }

  get companionBrowser(): BrowserPreference {
    const value = this.configuration().get<string>('companion.browser', 'config');
    if (isBrowserPreference(value) && value !== 'config') {
      return value;
    }
    if (this.browser !== 'config') {
      return this.browser;
    }
    const flake = this.configuration().get<string>('flakeLab.browser', 'config');
    if (isBrowserPreference(flake) && flake !== 'config') {
      return flake;
    }
    const inspector = this.configuration().get<string>('inspector.browser', 'config');
    if (isBrowserPreference(inspector) && inspector !== 'config') {
      return inspector;
    }
    return 'config';
  }

  get flakeLabBrowser(): BrowserPreference {
    const value = this.configuration().get<string>('flakeLab.browser', 'config');
    if (isBrowserPreference(value) && value !== 'config') {
      return value;
    }
    if (this.browser !== 'config') {
      return this.browser;
    }
    const companion = this.configuration().get<string>('companion.browser', 'config');
    if (isBrowserPreference(companion) && companion !== 'config') {
      return companion;
    }
    const inspector = this.configuration().get<string>('inspector.browser', 'config');
    if (isBrowserPreference(inspector) && inspector !== 'config') {
      return inspector;
    }
    return 'config';
  }

  get flakeLabSize(): FlakeLabSizePreset {
    const value = this.configuration().get<string>('flakeLab.size', 'standard');
    return value === 'quick' || value === 'deep' || value === 'custom' ? value : 'standard';
  }

  get flakeLabMaxScopeTests(): number {
    const value = this.configuration().get<number>('flakeLab.maxScopeTests', 15);
    return Number.isInteger(value) && value >= 0 ? value : 15;
  }

  get environment(): Record<string, string> {
    return this.configuration().get<Record<string, string>>('environment', {});
  }

  get flakeLabRepeatEach(): number {
    return positiveInteger(this.configuration().get<number>('flakeLab.repeatEach', 10), 10);
  }

  get flakeLabWorkers(): number {
    return positiveInteger(this.configuration().get<number>('flakeLab.workers', 1), 1);
  }

  get flakeLabRetries(): number {
    return clampInteger(this.configuration().get<number>('flakeLab.retries', 1), 0, 5, 1);
  }

  get flakeLabTrace(): string {
    const trace = this.configuration().get<string>('flakeLab.trace', 'on');
    return ['on', 'off', 'retain-on-failure', 'on-first-retry', 'on-all-retries'].includes(trace) ? trace : 'on';
  }

  get flakeLabFailOnFlakyTests(): boolean {
    return this.configuration().get<boolean>('flakeLab.failOnFlakyTests', true);
  }

  resolvedFlakeLabRepeatEach(sizeOverride?: string): number {
    return resolveFlakeLabRepeatEach(sizeOverride ?? this.flakeLabSize, this.flakeLabRepeatEach);
  }

  get uiProfiles(): UiProfile[] {
    return normalizeUiProfiles(this.configuration().get<unknown>('ui.profiles', []));
  }

  get uiDefaultProfile(): string | undefined {
    const value = this.configuration().get<string>('ui.defaultProfile', '').trim();
    return value || undefined;
  }

  get sidebarAutoFocus(): boolean {
    return this.configuration().get<boolean>('sidebar.autoFocus', true);
  }

  get sidebarRunsEnabled(): boolean {
    return this.configuration().get<boolean>('sidebar.runsEnabled', true);
  }

  get sidebarHistorySize(): number {
    return clampInteger(this.configuration().get<number>('sidebar.historySize', 3), 1, 10, 3);
  }

  get artifactScanDirectories(): string[] {
    const directories = this.configuration().get<unknown>('artifacts.scanDirectories', [
      'playwright-report', 'blob-report', 'test-results',
    ]);
    if (!Array.isArray(directories)) {
      return ['playwright-report', 'blob-report', 'test-results'];
    }
    return directories.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  }

  get codeLensEnabled(): boolean {
    return this.configuration().get<boolean>('codeLens.enabled', true);
  }

  get codeLensPattern(): string {
    const pattern = this.configuration().get<string>('codeLens.pattern', '');
    return pattern.length > 0 ? pattern : DEFAULT_CODE_LENS_PATTERN;
  }

  get codeLensLayout(): CodeLensLayout {
    const layout = this.configuration().get<string>('codeLens.layout', 'full');
    return layout === 'compact' || layout === 'custom' ? layout : 'full';
  }

  codeLensActions(kind: 'file' | 'suite' | 'test'): CodeLensAction[] {
    if (this.codeLensLayout === 'compact') {
      return [...COMPACT_ACTIONS];
    }
    if (this.codeLensLayout === 'full') {
      return kind === 'file' ? [...FULL_FILE_ACTIONS] : kind === 'suite' ? [...FULL_SUITE_ACTIONS] : [...FULL_TEST_ACTIONS];
    }
    const setting = kind === 'file' ? 'codeLens.fileActions' : kind === 'suite' ? 'codeLens.suiteActions' : 'codeLens.testActions';
    const configured = this.configuration().get<string[]>(setting, []);
    const allowed = ACTIONS_BY_KIND[kind];
    return [...new Set(configured.filter((action): action is CodeLensAction => (
      isCodeLensAction(action) && allowed.includes(action)
    )))];
  }
}

function isCodeLensAction(value: string): value is CodeLensAction {
  return value === 'run'
    || value === 'debug'
    || value === 'inspect'
    || value === 'ui'
    || value === 'config'
    || value === 'cases'
    || value === 'more';
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function clampInteger(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}
