import * as vscode from 'vscode';
import { ArtifactService } from './artifactService';
import { registerCodeLensSupport } from './codeLens';
import { registerCommands } from './commands';
import { CompanionCliRunner } from './companionRunner';
import { DiscoveryService } from './discoveryService';
import { InteractiveSessionManager } from './interactiveSessions';
import { OfficialPlaywrightBridge } from './officialPlaywrightBridge';
import { ProjectPicker } from './projectPicker';
import { ReportSessionManager } from './reportSession';
import { PlaywrightSidebar } from './sidebar';

export interface ExtensionApi {
  discovery: DiscoveryService;
  projects: ProjectPicker;
  bridge: OfficialPlaywrightBridge;
  runner: CompanionCliRunner;
  artifacts: ArtifactService;
}

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi | undefined> {
  if (!vscode.workspace.isTrusted) {
    return undefined;
  }

  const discovery = new DiscoveryService(context);
  const projects = new ProjectPicker(context, discovery);
  const bridge = new OfficialPlaywrightBridge();
  const runner = new CompanionCliRunner(context);
  const artifacts = new ArtifactService();
  const sessions = new InteractiveSessionManager();
  const reportSession = new ReportSessionManager();
  const sidebar = new PlaywrightSidebar(context, runner, artifacts, sessions, reportSession);

  context.subscriptions.push(discovery, runner, artifacts, sessions, reportSession);
  registerCommands({ context, discovery, bridge, projects, runner, artifacts, sessions, reportSession, sidebar });
  registerCodeLensSupport(context, discovery, runner);

  await bridge.activate();
  void discovery.refreshTargets().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Playwright target discovery failed: ${message}`);
  });

  return { discovery, projects, bridge, runner, artifacts };
}

export function deactivate(): void {
  // Disposables registered on the extension context are cleaned up by VS Code.
}
