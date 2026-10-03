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
import { PlaywrightTestExplorer } from './testExplorer';

export interface ExtensionApi {
  discovery: DiscoveryService;
  projects: ProjectPicker;
  bridge: OfficialPlaywrightBridge;
  runner: CompanionCliRunner;
  artifacts: ArtifactService;
  explorer: PlaywrightTestExplorer;
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
  const explorer = new PlaywrightTestExplorer(discovery, runner, sidebar);

  context.subscriptions.push(explorer, discovery, runner, artifacts, sessions, reportSession);
  registerCommands({ context, discovery, bridge, projects, runner, artifacts, sessions, reportSession, sidebar, explorer });
  registerCodeLensSupport(context, discovery, runner);

  void explorer.initialize();
  await bridge.activate();

  return { discovery, projects, bridge, runner, artifacts, explorer };
}

export function deactivate(): void {
  // Disposables registered on the extension context are cleaned up by VS Code.
}
