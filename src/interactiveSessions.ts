import * as vscode from 'vscode';
import { SingleActiveSession } from './core/singleActiveSession';
import { createCliTerminal } from './terminal';
import { RunTarget } from './runTarget';

export interface InteractiveSession {
  key: string;
  name: string;
  targetId: string;
  startedAt: number;
}

/** Owns the single long-lived Inspector/UI terminal for the extension. */
export class InteractiveSessionManager implements vscode.Disposable {
  private readonly active = new SingleActiveSession<vscode.Terminal, InteractiveSession>();
  private readonly emitter = new vscode.EventEmitter<readonly InteractiveSession[]>();
  private readonly closeListener: vscode.Disposable;

  constructor() {
    this.closeListener = vscode.window.onDidCloseTerminal((terminal) => {
      if (this.active.close(terminal)) {
        this.emitter.fire(this.sessions);
      }
    });
  }

  readonly onDidChange = this.emitter.event;

  get sessions(): readonly InteractiveSession[] {
    return this.active.value ? [this.active.value] : [];
  }

  launch(target: RunTarget, key: string, name: string, args: string[]): void {
    this.active.replace(() => {
      const terminal = createCliTerminal(target, name, args);
      return {
        handle: terminal,
        value: { key, name, targetId: target.id, startedAt: Date.now() },
      };
    });
    this.emitter.fire(this.sessions);
    const terminal = this.active.handle;
    if (!terminal) {
      return;
    }
    terminal.show(true);
  }

  stop(): void {
    if (!this.active.value) {
      return;
    }
    this.active.dispose();
    this.emitter.fire(this.sessions);
  }

  dispose(): void {
    this.closeListener.dispose();
    this.active.dispose();
    this.emitter.dispose();
  }
}
