import * as vscode from 'vscode';
import { environmentForCli } from './core/cliResolution';
import { quoteForTerminal } from './core/terminalQuote';
import { RunTarget } from './runTarget';

export interface InteractiveSession {
  key: string;
  name: string;
  targetId: string;
  startedAt: number;
}

/** Reuses long-lived Inspector/UI terminals for an execution target/profile. */
export class InteractiveSessionManager implements vscode.Disposable {
  private readonly terminals = new Map<string, vscode.Terminal>();
  private readonly activeSessions = new Map<string, InteractiveSession>();
  private readonly emitter = new vscode.EventEmitter<readonly InteractiveSession[]>();
  private readonly closeListener: vscode.Disposable;

  constructor() {
    this.closeListener = vscode.window.onDidCloseTerminal((terminal) => {
      for (const [key, existing] of this.terminals) {
        if (existing === terminal) {
          this.terminals.delete(key);
          this.activeSessions.delete(key);
          this.emitter.fire(this.sessions);
        }
      }
    });
  }

  readonly onDidChange = this.emitter.event;

  get sessions(): readonly InteractiveSession[] {
    return [...this.activeSessions.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  launch(target: RunTarget, key: string, name: string, args: string[]): void {
    const existing = this.terminals.get(key);
    if (existing) {
      existing.show(true);
      void vscode.window.showInformationMessage(`${name} is already running for this target.`);
      return;
    }
    const terminal = vscode.window.createTerminal({
      name,
      cwd: target.cwd,
      env: environmentForCli(target.cli, target.env),
    });
    this.terminals.set(key, terminal);
    this.activeSessions.set(key, { key, name, targetId: target.id, startedAt: Date.now() });
    this.emitter.fire(this.sessions);
    terminal.sendText(quoteForTerminal(target.cli.executable, [...target.cli.argsPrefix, ...args]));
    terminal.show(true);
  }

  dispose(): void {
    this.closeListener.dispose();
    this.terminals.clear();
    this.activeSessions.clear();
    this.emitter.dispose();
  }
}
