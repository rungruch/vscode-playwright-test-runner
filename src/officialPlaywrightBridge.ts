import * as vscode from 'vscode';
import { EditorTestSelection } from './core/editorSelections';
import {
  OFFICIAL_PLAYWRIGHT_EXTENSION_ID,
  OfficialRunMode,
  officialCommandFor,
  officialIntegrationError,
} from './core/officialCommands';

/** Delegates native test execution to Microsoft's Playwright TestController. */
export class OfficialPlaywrightBridge {
  private activation: Promise<boolean> | undefined;

  async activate(): Promise<boolean> {
    this.activation ??= this.activateOfficialExtension();
    return this.activation;
  }

  async run(selection: EditorTestSelection, mode: OfficialRunMode): Promise<void> {
    const invocation = officialCommandFor(selection, mode);
    if (!(await this.ensureCommand(invocation.command))) {
      return;
    }

    const uri = vscode.Uri.parse(selection.uri);
    if (invocation.usesUri) {
      await vscode.commands.executeCommand(invocation.command, uri);
      return;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
    const requested = new vscode.Position(selection.position.line, selection.position.character);
    const position = document.validatePosition(requested);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    await vscode.commands.executeCommand(invocation.command);
  }

  async runAtActiveCursor(mode: OfficialRunMode): Promise<void> {
    const command = mode === 'run' ? 'testing.runAtCursor' : 'testing.debugAtCursor';
    if (await this.ensureCommand(command)) {
      await vscode.commands.executeCommand(command);
    }
  }

  async refresh(): Promise<void> {
    await this.executeRequiredCommand('testing.refreshTests');
  }

  async rerunLast(): Promise<void> {
    await this.executeRequiredCommand('testing.reRunLastRun');
  }

  async openOfficialSettings(): Promise<void> {
    if (!(await this.activate())) {
      return;
    }
    const commands = new Set(await vscode.commands.getCommands(true));
    const focusCommand = 'pw.extension.settingsView.focus';
    if (commands.has(focusCommand)) {
      await vscode.commands.executeCommand(focusCommand);
      return;
    }
    await vscode.commands.executeCommand('workbench.view.extension.test');
  }

  private async executeRequiredCommand(command: string): Promise<void> {
    if (await this.ensureCommand(command)) {
      await vscode.commands.executeCommand(command);
    }
  }

  private async ensureCommand(command: string): Promise<boolean> {
    const active = await this.activate();
    const commands = new Set(await vscode.commands.getCommands(true));
    const error = officialIntegrationError(active, commands, command);
    if (error) {
      void vscode.window.showErrorMessage(error);
      return false;
    }
    return true;
  }

  private async activateOfficialExtension(): Promise<boolean> {
    const extension = vscode.extensions.getExtension(OFFICIAL_PLAYWRIGHT_EXTENSION_ID);
    if (!extension) {
      const action = await vscode.window.showErrorMessage(
        `Playwright CodeLens requires ${OFFICIAL_PLAYWRIGHT_EXTENSION_ID}.`,
        'Show Extension',
      );
      if (action === 'Show Extension') {
        await vscode.commands.executeCommand('workbench.extensions.search', `@id:${OFFICIAL_PLAYWRIGHT_EXTENSION_ID}`);
      }
      return false;
    }
    try {
      await extension.activate();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Could not activate ${OFFICIAL_PLAYWRIGHT_EXTENSION_ID}: ${message}`);
      return false;
    }
  }
}
