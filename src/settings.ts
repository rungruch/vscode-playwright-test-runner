import * as vscode from 'vscode';
import { UiProfile } from './core/companionTypes';
import { normalizeUiProfiles } from './core/uiProfiles';
import { InspectorBrowser, isInspectorBrowser } from './core/inspectorBrowser';

/** Public configuration namespace for the extension. */
export const SETTINGS_NAMESPACE = 'playwrightCodeLensRunner';

const DEFAULT_CODE_LENS_PATTERN = '**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}';

export type CodeLensLayout = 'full' | 'compact' | 'custom';
export type CodeLensAction = 'run' | 'debug' | 'inspect' | 'ui' | 'config' | 'cases' | 'more';

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

  /** Browser/project override applied only to Playwright Inspector commands. */
  get inspectorBrowser(): InspectorBrowser {
    const value = this.configuration().get<string>('inspector.browser', 'config');
    return isInspectorBrowser(value) ? value : 'config';
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
