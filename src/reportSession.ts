import * as path from 'path';
import * as vscode from 'vscode';
import { environmentForCli } from './core/cliResolution';
import { buildShowReportArguments } from './core/reportServer';
import { SingleActiveSession } from './core/singleActiveSession';
import { quoteForTerminal } from './core/terminalQuote';
import { RunTarget } from './runTarget';

export interface ReportSession {
  targetId: string;
  target: RunTarget;
  reportPath?: string;
  name: string;
  startedAt: number;
}

/**
 * Manages the single long-lived Playwright report server terminal for the extension.
 * Replaces any running report server when launching a new one to prevent orphaned ports,
 * and allows explicit stopping and restarting from the sidebar.
 */
export class ReportSessionManager implements vscode.Disposable {
  private readonly active = new SingleActiveSession<vscode.Terminal, ReportSession>();
  private readonly emitter = new vscode.EventEmitter<ReportSession | undefined>();
  private readonly closeListener: vscode.Disposable;
  private lastTarget?: RunTarget;
  private lastReportPath?: string;

  constructor() {
    this.closeListener = vscode.window.onDidCloseTerminal((terminal) => {
      if (this.active.close(terminal)) {
        this.emitter.fire(undefined);
      }
    });
  }

  readonly onDidChange = this.emitter.event;

  get currentSession(): ReportSession | undefined {
    return this.active.value;
  }

  get isRunning(): boolean {
    return this.active.value !== undefined;
  }

  get lastReport(): { target?: RunTarget; reportPath?: string } {
    return { target: this.lastTarget, reportPath: this.lastReportPath };
  }

  launch(target: RunTarget, reportPath?: string): void {
    this.lastTarget = target;
    this.lastReportPath = reportPath;

    const reportName = reportPath ? path.basename(reportPath) : 'HTML report';
    const name = `Playwright Report: ${reportName}`;

    this.active.replace(() => {
      const terminal = vscode.window.createTerminal({
        name: 'Playwright Report',
        cwd: target.cwd,
        env: environmentForCli(target.cli, target.env),
      });
      return {
        handle: terminal,
        value: {
          targetId: target.id,
          target,
          reportPath,
          name,
          startedAt: Date.now(),
        },
      };
    });

    this.emitter.fire(this.active.value);
    const terminal = this.active.handle;
    if (!terminal) {
      return;
    }
    const args = buildShowReportArguments(reportPath);
    terminal.sendText(quoteForTerminal(target.cli.executable, [...target.cli.argsPrefix, ...args]));
    terminal.show(true);
  }

  stop(): void {
    if (!this.active.value) {
      return;
    }
    this.active.dispose();
    this.emitter.fire(undefined);
  }

  restart(): boolean {
    if (!this.lastTarget) {
      return false;
    }
    this.launch(this.lastTarget, this.lastReportPath);
    return true;
  }

  dispose(): void {
    this.closeListener.dispose();
    this.active.dispose();
    this.emitter.dispose();
  }
}
