import * as vscode from 'vscode';
import { CompanionRunSummary } from './core/companionTypes';

/** A read-only terminal renders Playwright's ANSI colors, diffs and code frames. */
export class CompanionOutput implements vscode.Disposable {
  private readonly terminals = new Map<string, { terminal: vscode.Terminal; write(text: string): void }>();

  constructor(private readonly createTerminal: (options: vscode.ExtensionTerminalOptions) => vscode.Terminal = vscode.window.createTerminal) {}

  show(run: CompanionRunSummary): void {
    let entry = this.terminals.get(run.id);
    if (!entry) {
      const emitter = new vscode.EventEmitter<string>();
      let ready = false;
      let pending = `\x1b[1;36mPlaywright ${run.kind}\x1b[0m — ${run.status}\n`
        + `Config: ${run.configFile ?? run.cwd}\nStarted: ${new Date(run.startedAt).toLocaleString()}\n`
        + `Retained output tail (up to 24,000 characters).\n\n${run.output ?? ''}`;
      const terminal = this.createTerminal({
        name: `Playwright: ${run.kind} · ${new Date(run.startedAt).toLocaleTimeString()}`,
        iconPath: new vscode.ThemeIcon('beaker'),
        location: vscode.TerminalLocation.Panel,
        pty: {
          onDidWrite: emitter.event,
          open: () => { ready = true; emitter.fire(toTerminalLines(pending)); pending = ''; },
          close: () => { this.terminals.delete(run.id); emitter.dispose(); },
        },
      });
      entry = { terminal, write: (text) => {
        if (ready) { emitter.fire(toTerminalLines(text)); } else { pending += text; }
      } };
      this.terminals.set(run.id, entry);
    }
    entry.terminal.show(true);
  }

  append(runId: string, text: string): void {
    this.terminals.get(runId)?.write(text);
  }

  dispose(): void {
    for (const { terminal } of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
  }
}

function toTerminalLines(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}
