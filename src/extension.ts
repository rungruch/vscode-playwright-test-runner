import * as vscode from 'vscode';
import { registerCodeLensSupport } from './codeLens';
import { registerCommands } from './commands';
import { DiscoveryService } from './discoveryService';
import { registerLegacyAliases } from './legacyAliases';
import { OfficialPlaywrightBridge } from './officialPlaywrightBridge';
import { ProjectPicker } from './projectPicker';

export interface ExtensionApi {
  discovery: DiscoveryService;
  projects: ProjectPicker;
  bridge: OfficialPlaywrightBridge;
}

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi | undefined> {
  if (!vscode.workspace.isTrusted) {
    return undefined;
  }

  const discovery = new DiscoveryService();
  const projects = new ProjectPicker(context, discovery);
  const bridge = new OfficialPlaywrightBridge();

  context.subscriptions.push(discovery);
  registerCommands({ context, discovery, bridge, projects });
  registerLegacyAliases(context);
  registerCodeLensSupport(context, discovery);

  await bridge.activate();
  void discovery.refreshTargets();

  return { discovery, projects, bridge };
}

export function deactivate(): void {
  // Disposables registered on the extension context are cleaned up by VS Code.
}
