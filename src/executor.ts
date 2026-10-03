import { ChildProcess, spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import { CliCommand, environmentForCli } from './core/cliResolution';

const CLI_PROBE_TIMEOUT_MS = 15_000;

export interface CancellationTokenLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

interface SpawnOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  cancelled: boolean;
  timedOut: boolean;
}

export interface RunningCommand {
  readonly outcome: Promise<SpawnOutcome>;
  /** Interrupts (SIGINT) then terminates the complete process tree. */
  cancel(): void;
  readonly pid: number | undefined;
}

export interface SpawnOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  cancellation?: CancellationTokenLike;
  timeoutMs?: number;
}

/**
 * Spawns a structured command without a shell. Dynamic values are never
 * interpolated into shell strings.
 */
export function spawnCommand(cli: CliCommand, args: string[], options: SpawnOptions): RunningCommand {
  const isWindows = process.platform === 'win32';
  const env = environmentForCli(cli, { ...process.env, ...options.env });
  const child: ChildProcess = crossSpawn(cli.executable, [...cli.argsPrefix, ...args], {
    cwd: options.cwd,
    env,
    shell: false,
    // Own process group on POSIX so the whole tree can be signalled.
    detached: !isWindows,
    windowsHide: true,
  });

  let settled = false;
  let stopReason: 'cancelled' | 'timeout' | undefined;
  let timeoutTimer: NodeJS.Timeout | undefined;
  let escalationTimer: NodeJS.Timeout | undefined;
  let forceTimer: NodeJS.Timeout | undefined;
  let cancelSubscription: { dispose(): void } | undefined;
  let shutdown: Promise<void> = Promise.resolve();

  const clearTimer = (timer: NodeJS.Timeout | undefined) => {
    if (timer) {
      clearTimeout(timer);
    }
  };

  const cleanup = () => {
    clearTimer(timeoutTimer);
    clearTimer(escalationTimer);
    clearTimer(forceTimer);
    timeoutTimer = undefined;
    escalationTimer = undefined;
    forceTimer = undefined;
    cancelSubscription?.dispose();
    cancelSubscription = undefined;
  };

  const killTree = (force: boolean): Promise<void> => {
    if (child.pid === undefined) {
      return Promise.resolve();
    }
    if (isWindows) {
      const args = ['/pid', String(child.pid), '/T'];
      if (force) {
        args.push('/F');
      }
      return new Promise<void>((resolve) => {
        const killer = spawn('taskkill', args, { shell: false, windowsHide: true });
        killer.on('error', () => { child.kill(); resolve(); });
        killer.on('close', () => resolve());
      });
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
    return Promise.resolve();
  };

  const interrupt = (): Promise<void> => {
    if (child.pid === undefined) {
      return Promise.resolve();
    }
    if (isWindows) {
      // taskkill must capture descendants while their parent still exists.
      return killTree(true);
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
    return new Promise((resolve) => {
      const groupAlive = () => {
        try { process.kill(-child.pid!, 0); return true; } catch { return false; }
      };
      const poll = setInterval(() => {
        if (!groupAlive()) {
          clearInterval(poll);
          clearTimer(escalationTimer);
          clearTimer(forceTimer);
          resolve();
        }
      }, 100);
      escalationTimer = setTimeout(() => {
        killTree(false);
        forceTimer = setTimeout(() => {
          killTree(true);
          clearInterval(poll);
          resolve();
        }, 2000);
      }, 2000);
    });
  };

  const outcome = new Promise<SpawnOutcome>((resolve) => {
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }
      settled = true;
      // Parent exit does not imply process-group exit. Keep escalation alive
      // until descendants have been terminated, even if stdio is already closed.
      void shutdown.then(() => {
        cleanup();
        resolve({ exitCode, signal, cancelled: stopReason === 'cancelled', timedOut: stopReason === 'timeout' });
      });
    };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (data: string) => options.onStdout?.(data));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (data: string) => options.onStderr?.(data));
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        options.onStderr?.(`Command not found: ${cli.executable}\n`);
      } else {
        options.onStderr?.(`Failed to start ${cli.executable}: ${error.message}\n`);
      }
      finish(null, null);
    });
    child.on('close', (code, signal) => {
      finish(code, signal);
    });
  });

  const requestStop = (reason: 'cancelled' | 'timeout') => {
    if (settled || stopReason) {
      return;
    }
    stopReason = reason;
    shutdown = interrupt();
  };

  cancelSubscription = options.cancellation?.onCancellationRequested(() => requestStop('cancelled'));
  if (options.cancellation?.isCancellationRequested) {
    requestStop('cancelled');
  } else if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
    timeoutTimer = setTimeout(() => requestStop('timeout'), options.timeoutMs);
  }

  return {
    outcome,
    cancel: () => requestStop('cancelled'),
    pid: child.pid,
  };
}

/**
 * Runs `<cli> --version` and returns the raw output (or undefined when the
 * CLI cannot be executed).
 */
export async function probeCliVersion(
  cli: CliCommand,
  cwd: string,
  env: Record<string, string>,
  cancellation?: CancellationTokenLike,
): Promise<{ output: string; ok: boolean; timedOut: boolean }> {
  let output = '';
  const running = spawnCommand(cli, ['--version'], {
    cwd,
    env,
    cancellation,
    timeoutMs: CLI_PROBE_TIMEOUT_MS,
    onStdout: (t) => (output += t),
    onStderr: (t) => (output += t),
  });
  const result = await running.outcome;
  const trimmed = output.trim();
  return {
    output: trimmed,
    ok: result.exitCode === 0 && !result.cancelled && !result.timedOut && trimmed.length > 0,
    timedOut: result.timedOut,
  };
}
