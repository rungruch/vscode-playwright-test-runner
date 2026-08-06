import * as vscode from 'vscode';
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
const FULL_FILE_ACTIONS: readonly CodeLensAction[] = ['run', 'debug', 'ui', 'config'];
const FULL_SUITE_ACTIONS: readonly CodeLensAction[] = ['run', 'debug', 'inspect', 'ui'];
const FULL_TEST_ACTIONS: readonly CodeLensAction[] = ['run', 'debug', 'inspect', 'ui', 'cases'];
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
