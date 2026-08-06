import { PackageManager, detectPackageManager, findLocalPlaywrightCli } from './packageManager';

/**
 * A fully structured command: executable plus argv prefix. The runner always
 * spawns with `shell: false`; dynamic values are never interpolated into a
 * shell string.
 */
export interface CliCommand {
  executable: string;
  /** Arguments placed before the Playwright sub-command (e.g. ['playwright'] for npx). */
  argsPrefix: string[];
  /** Human-readable origin for diagnostics. */
  source: 'explicit' | 'local-install' | 'package-manager';
}

export interface CliResolutionOptions {
  /** Explicit executable from settings (wins over detection). */
  executable?: string;
  /** Explicit argument prefix from settings. */
  arguments?: string[];
  /** Directory the CLI will run in (usually the config directory). */
  cwd: string;
  /** Workspace folder boundary for upward detection walks. */
  workspaceFolder?: string;
  /** Overridable for tests. */
  nodeExecutable?: string;
}

/**
 * Adds the runtime environment required by locally installed CLI entry points.
 * In a VS Code extension host, process.execPath is Electron's helper binary;
 * ELECTRON_RUN_AS_NODE makes that same binary behave as the Node runtime.
 */
export function environmentForCli(
  cli: CliCommand,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result = { ...environment };
  if (cli.source === 'local-install' && cli.executable === process.execPath) {
    result.ELECTRON_RUN_AS_NODE = '1';
  }
  return result;
}

export function resolveCli(options: CliResolutionOptions): CliCommand {
  const explicit = options.executable?.trim();
  if (explicit) {
    return {
      executable: explicit,
      argsPrefix: sanitizeArguments(options.arguments),
      source: 'explicit',
    };
  }

  const local = findLocalPlaywrightCli(options.cwd, options.workspaceFolder);
  if (local) {
    // Run the local CLI through node directly: cross-platform, no .cmd shims,
    // no dependency on the global npm/npx installation.
    return {
      executable: options.nodeExecutable ?? process.execPath,
      argsPrefix: [local],
      source: 'local-install',
    };
  }

  return packageManagerCommand(detectPackageManager(options.cwd, options.workspaceFolder));
}

export function packageManagerCommand(manager: PackageManager): CliCommand {
  const win = process.platform === 'win32';
  switch (manager) {
    case 'pnpm':
      return { executable: win ? 'pnpm.cmd' : 'pnpm', argsPrefix: ['exec', 'playwright'], source: 'package-manager' };
    case 'yarn':
      return { executable: win ? 'yarn.cmd' : 'yarn', argsPrefix: ['playwright'], source: 'package-manager' };
    case 'bun':
      return { executable: win ? 'bunx.cmd' : 'bunx', argsPrefix: ['playwright'], source: 'package-manager' };
    case 'npm':
    default:
      return { executable: win ? 'npx.cmd' : 'npx', argsPrefix: ['playwright'], source: 'package-manager' };
  }
}

function sanitizeArguments(args: string[] | undefined): string[] {
  if (!Array.isArray(args)) {
    return [];
  }
  return args.filter((a): a is string => typeof a === 'string' && a.length > 0);
}
