import * as path from 'path';
import * as vscode from 'vscode';
import { environmentForCli } from './core/cliResolution';
import { RunTarget } from './runTarget';

/** Launch argv directly through a bundled Node relay, rather than shell text. */
export function createCliTerminal(target: RunTarget, name: string, args: string[], launcherPath = path.join(__dirname, 'terminalLauncher.cjs')): vscode.Terminal {
  return vscode.window.createTerminal({
    name,
    cwd: target.cwd,
    shellPath: process.execPath,
    shellArgs: [launcherPath, target.cli.executable, ...target.cli.argsPrefix, ...args],
    env: { ...environmentForCli(target.cli, target.env), ELECTRON_RUN_AS_NODE: '1' },
  });
}
