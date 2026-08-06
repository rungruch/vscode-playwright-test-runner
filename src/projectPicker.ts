import * as vscode from 'vscode';
import { projectStateKey, reconcileProjectSelection } from './core/projectSelection';
import { DiscoveryService } from './discoveryService';
import { RunTarget, targetLabel } from './runTarget';

/**
 * Persisted multi-select project choice for companion CLI Inspector/UI runs.
 * Microsoft's enabled projects remain private and independently owned by the
 * official extension.
 */
export class ProjectPicker {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly discovery: DiscoveryService,
  ) {}

  /**
   * Returns the selected projects for a target. An empty array means "all
   * projects" (no --project flags are passed).
   */
  async getProjects(target: RunTarget): Promise<string[]> {
    const key = projectStateKey(target.id);
    const stored = this.context.workspaceState.get<string[]>(key);
    if (!stored) {
      return [];
    }
    const projects = await this.knownProjects(target);
    const reconciled = reconcileProjectSelection(stored, projects);
    if (reconciled.length !== stored.length || reconciled.some((project, index) => project !== stored[index])) {
      await this.context.workspaceState.update(key, reconciled);
    }
    return reconciled;
  }

  /** Multi-select Quick Pick; persists the choice in workspace state. */
  async configure(target?: RunTarget): Promise<void> {
    const chosen = target ?? (await this.pickTarget());
    if (!chosen) {
      return;
    }
    const projects = await this.knownProjects(chosen) ?? [];
    const current = await this.getProjects(chosen);
    const picks = projects.map((name) => ({
      label: name,
      picked: current.length === 0 || current.includes(name),
    }));
    if (picks.length === 0) {
      void vscode.window.showInformationMessage('No Playwright projects are known for this config yet. Run discovery first.');
      return;
    }
    const result = await vscode.window.showQuickPick(picks, {
      title: `CLI projects for ${targetLabel(chosen)}`,
      placeHolder: 'Used by Inspector and Playwright UI (none selected = all)',
      canPickMany: true,
    });
    if (!result) {
      return;
    }
    const selected = result.map((r) => r.label);
    const allSelected = selected.length === projects.length || selected.length === 0;
    await this.context.workspaceState.update(projectStateKey(chosen.id), allSelected ? [] : selected);
  }

  private async knownProjects(target: RunTarget): Promise<string[] | undefined> {
    const cached = this.discovery.cachedModel(target.id);
    if (cached) {
      return cached.projects;
    }
    const model = await this.discovery.discover(target);
    return model?.projects;
  }

  private async pickTarget(): Promise<RunTarget | undefined> {
    const targets = this.discovery.currentTargets.length > 0
      ? this.discovery.currentTargets
      : await this.discovery.refreshTargets();
    if (targets.length === 0) {
      void vscode.window.showInformationMessage('No Playwright configs found in this workspace.');
      return undefined;
    }
    if (targets.length === 1) {
      return targets[0];
    }
    const picked = await vscode.window.showQuickPick(
      targets.map((t) => ({ label: targetLabel(t), target: t })),
      { title: 'Select a Playwright config' },
    );
    return picked?.target;
  }
}
