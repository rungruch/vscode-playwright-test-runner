import { ChildProcess, spawn } from 'child_process';
import * as vscode from 'vscode';
import { CliCommand, environmentForCli } from './core/cliResolution';

export interface SpawnOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  cancelled: boolean;
}

export interface RunningCommand {
  readonly outcome: Promise<SpawnOutcome>;
  /** Interrupts (SIGINT) then terminates the complete process tree. */
  cancel(): void;
  readonly pid: number | undefined;
}

export interface SpawnOptions {
  cwd: string;
  env: Record<string, string>;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  cancellation?: vscode.CancellationToken;
}

/**
 * Spawns a structured command without a shell. Dynamic values are never
 * interpolated into shell strings.
 */
export function spawnCommand(cli: CliCommand, args: string[], options: SpawnOptions): RunningCommand {
  const isWindows = process.platform === 'win32';
  const env = environmentForCli(cli, { ...process.env, ...options.env });
  const child: ChildProcess = spawn(cli.executable, [...cli.argsPrefix, ...args], {
    cwd: options.cwd,
    env,
    shell: false,
    // Own process group on POSIX so the whole tree can be signalled.
    detached: !isWindows,
    windowsHide: true,
  });

  let cancelled = false;
  let killTimer: NodeJS.Timeout | undefined;

  const killTree = (force: boolean) => {
    if (child.pid === undefined) {
      return;
    }
    if (isWindows) {
      const args = ['/pid', String(child.pid), '/T'];
      if (force) {
        args.push('/F');
      }
      try {
        spawn('taskkill', args, { shell: false, windowsHide: true });
      } catch {
        /* best effort */
      }
      return;
    }
    const signal = force ? 'SIGKILL' : 'SIGTERM';
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  };

  const interrupt = () => {
    if (child.pid === undefined) {
      return;
    }
    if (isWindows) {
      killTree(false);
      killTimer = setTimeout(() => killTree(true), 2000);
      return;
    }
    try {
      // Graceful interrupt first so Playwright can flush reporters.
      process.kill(-child.pid, 'SIGINT');
    } catch {
      try {
        child.kill('SIGINT');
      } catch {
        /* already gone */
      }
    }
    killTimer = setTimeout(() => {
      killTree(false);
      killTimer = setTimeout(() => killTree(true), 2000);
    }, 2000);
  };

  const cancelSubscription = options.cancellation?.onCancellationRequested(() => {
    cancelled = true;
    interrupt();
  });

  const outcome = new Promise<SpawnOutcome>((resolve) => {
    child.stdout?.on('data', (data: Buffer) => options.onStdout?.(data.toString('utf8')));
    child.stderr?.on('data', (data: Buffer) => options.onStderr?.(data.toString('utf8')));
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        options.onStderr?.(`Command not found: ${cli.executable}\n`);
      } else {
        options.onStderr?.(`Failed to start ${cli.executable}: ${error.message}\n`);
      }
      cleanup();
      resolve({ exitCode: null, signal: null, cancelled });
    });
    child.on('close', (code, signal) => {
      cleanup();
      resolve({ exitCode: code, signal, cancelled });
    });
  });

  const cleanup = () => {
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = undefined;
    }
    cancelSubscription?.dispose();
  };

  return {
    outcome,
    cancel: () => {
      cancelled = true;
      interrupt();
    },
    pid: child.pid,
  };
}

/**
 * Runs `<cli> --version` and returns the raw output (or undefined when the
 * CLI cannot be executed).
 */
export async function probeCliVersion(cli: CliCommand, cwd: string, env: Record<string, string>): Promise<{ output: string; ok: boolean }> {
  let output = '';
  const running = spawnCommand(cli, ['--version'], {
    cwd,
    env,
    onStdout: (t) => (output += t),
    onStderr: (t) => (output += t),
  });
  const result = await running.outcome;
  return { output: output.trim(), ok: result.exitCode === 0 && output.trim().length > 0 };
}
