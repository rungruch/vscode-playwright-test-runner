import * as vscode from 'vscode';
import {
  LEGACY_NAMESPACE,
  LegacySettings,
  MigratedSettings,
  NEW_NAMESPACE,
  convertLegacySettings,
} from './core/legacySettings';

const LEGACY_KEYS: (keyof LegacySettings)[] = [
  'playwrightConfigPath',
  'projectPath',
  'playwrightRunProject',
  'playwrightDebugProject',
  'playwrightInspectProject',
  'playwrightRunOptions',
  'playwrightEnvironmentVariables',
  'playwrightCommand',
  'disableCodeLens',
  'codeLensSelector',
  'changeDirectoryToWorkspaceRoot',
];

type Scope = 'global' | 'workspace' | 'workspaceFolder';

interface PendingChange {
  scope: Scope;
  resource: vscode.Uri | undefined;
  settings: MigratedSettings;
}

/**
 * Implements `playwrightCliRunner.migrateSettings`: scans the legacy
 * `playwrightrunner.*` namespace at every scope, previews the equivalent
 * `playwrightCliRunner.*` values, and writes them only after confirmation.
 * Legacy keys are never deleted automatically.
 */
export async function migrateSettings(): Promise<void> {
  const changes = collectChanges();
  if (changes.length === 0) {
    void vscode.window.showInformationMessage('No legacy playwrightrunner.* settings found.');
    return;
  }

  const lines: string[] = [];
  for (const change of changes) {
    lines.push(`**${scopeLabel(change.scope, change.resource)}**`);
    for (const [key, value] of Object.entries(change.settings)) {
      lines.push(`- ${NEW_NAMESPACE}.${key} = ${JSON.stringify(value)}`);
    }
    lines.push('');
  }
  lines.push('Legacy playwrightrunner.* keys are left in place; remove them manually when satisfied.');

  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: `# Playwright CLI Test Runner — settings migration preview\n\n${lines.join('\n')}`,
  });
  await vscode.window.showTextDocument(document, { preview: true });

  const confirm = await vscode.window.showInformationMessage(
    'Apply these playwrightCliRunner.* settings?',
    { modal: true },
    'Apply',
  );
  if (confirm !== 'Apply') {
    return;
  }

  for (const change of changes) {
    const config = vscode.workspace.getConfiguration(NEW_NAMESPACE, change.resource);
    const target = toConfigurationTarget(change.scope);
    for (const [key, value] of Object.entries(change.settings)) {
      await config.update(key, value, target);
    }
  }
  void vscode.window.showInformationMessage('Settings migrated to playwrightCliRunner.*.');
}

function collectChanges(): PendingChange[] {
  const changes: PendingChange[] = [];

  const globalLegacy = readLegacyAt('global', undefined);
  const globalConverted = convertLegacySettings(globalLegacy);
  if (Object.keys(globalConverted).length > 0) {
    changes.push({ scope: 'global', resource: undefined, settings: globalConverted });
  }

  const workspaceLegacy = readLegacyAt('workspace', undefined);
  const workspaceConverted = convertLegacySettings(workspaceLegacy);
  if (Object.keys(workspaceConverted).length > 0) {
    changes.push({ scope: 'workspace', resource: undefined, settings: workspaceConverted });
  }

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const folderLegacy = readLegacyAt('workspaceFolder', folder.uri);
    const folderConverted = convertLegacySettings(folderLegacy);
    if (Object.keys(folderConverted).length > 0) {
      changes.push({ scope: 'workspaceFolder', resource: folder.uri, settings: folderConverted });
    }
  }

  return changes;
}

function readLegacyAt(scope: Scope, resource: vscode.Uri | undefined): LegacySettings {
  const config = vscode.workspace.getConfiguration(LEGACY_NAMESPACE, resource);
  const legacy: LegacySettings = {};
  for (const key of LEGACY_KEYS) {
    const inspected = config.inspect(key);
    let value: unknown;
    switch (scope) {
      case 'global':
        value = inspected?.globalValue;
        break;
      case 'workspace':
        value = inspected?.workspaceValue;
        break;
      case 'workspaceFolder':
        value = inspected?.workspaceFolderValue;
        break;
    }
    if (value !== undefined) {
      (legacy as Record<string, unknown>)[key] = value;
    }
  }
  return legacy;
}

function toConfigurationTarget(scope: Scope): vscode.ConfigurationTarget {
  switch (scope) {
    case 'global':
      return vscode.ConfigurationTarget.Global;
    case 'workspace':
      return vscode.ConfigurationTarget.Workspace;
    case 'workspaceFolder':
      return vscode.ConfigurationTarget.WorkspaceFolder;
  }
}

function scopeLabel(scope: Scope, resource: vscode.Uri | undefined): string {
  switch (scope) {
    case 'global':
      return 'User settings';
    case 'workspace':
      return 'Workspace settings';
    case 'workspaceFolder':
      return `Folder settings (${resource?.fsPath ?? ''})`;
  }
}
