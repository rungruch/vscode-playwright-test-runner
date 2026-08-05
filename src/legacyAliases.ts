import * as vscode from 'vscode';
import { normalizeLegacyArguments } from './core/legacyArguments';

const UPSTREAM_EXTENSION_ID = 'sakamoto66.vscode-playwright-test-runner';

/**
 * Registers deprecated `playwright.*` command aliases that forward to the new
 * `playwrightCliRunner.*` commands. Skipped entirely when the upstream
 * extension is installed, to avoid command collisions.
 */
export function registerLegacyAliases(context: vscode.ExtensionContext): void {
  if (vscode.extensions.getExtension(UPSTREAM_EXTENSION_ID)) {
    return;
  }

  const forward = (legacyId: string, newId: string) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(legacyId, async (...args: unknown[]) => {
        void vscode.window.showWarningMessage(
          `Command "${legacyId}" is deprecated; use "${newId}" instead.`,
        );
        return vscode.commands.executeCommand(newId, ...normalizeLegacyArguments(legacyId, args));
      }),
    );
  };

  forward('playwright.runTest', 'playwrightCliRunner.runTest');
  forward('playwright.runCurrentFile', 'playwrightCliRunner.runFile');
  forward('playwright.runTestPath', 'playwrightCliRunner.runFile');
  forward('playwright.debugTest', 'playwrightCliRunner.debugTest');
  forward('playwright.debugCurrentFile', 'playwrightCliRunner.debugFile');
  forward('playwright.debugTestPath', 'playwrightCliRunner.debugFile');
  forward('playwright.inspectTest', 'playwrightCliRunner.inspectTest');
  forward('playwright.runPrevTest', 'playwrightCliRunner.rerunLast');
  forward('playwright.showTestReport', 'playwrightCliRunner.showReport');
  forward('playwright.showTrace', 'playwrightCliRunner.showTrace');
  forward('playwright.codeGen', 'playwrightCliRunner.recordTest');

  context.subscriptions.push(
    vscode.commands.registerCommand('playwright.runTestAndUpdateSnapshots', () => {
      void vscode.window.showErrorMessage(
        'Snapshot runs are now owned by the Microsoft Playwright extension. ' +
        'Configure playwright.updateSnapshots there, or use the Playwright CLI directly.',
      );
    }),
    vscode.commands.registerCommand('playwright.runCurrentFileWithCoverage', () => {
      void vscode.window.showErrorMessage(
        'playwright.runCurrentFileWithCoverage is no longer supported: Playwright has no native --coverage command. ' +
        'Collect coverage through your own Playwright setup (e.g. a coverage-enabled webServer) instead.',
      );
    }),
  );
}
