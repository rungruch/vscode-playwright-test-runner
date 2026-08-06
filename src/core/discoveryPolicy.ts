import * as path from 'path';

const ANSI_ESCAPE_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

export interface DiscoveryTargetPaths {
  id: string;
  configDir: string;
  workspaceDir: string;
  cachedRootDir?: string;
}

/**
 * Ranks candidate configs using Playwright's last reported root directory
 * before falling back to filesystem topology. A config can live outside the
 * directory that contains its tests, so config proximity alone is not a
 * reliable ownership signal after discovery has succeeded once.
 */
export function rankDiscoveryTargets<T>(
  targets: readonly T[],
  fsPath: string,
  describe: (target: T) => DiscoveryTargetPaths,
): T[] {
  return [...targets].sort((a, b) => {
    const aPaths = describe(a);
    const bPaths = describe(b);
    const aRootContains = Boolean(aPaths.cachedRootDir && containsPath(aPaths.cachedRootDir, fsPath));
    const bRootContains = Boolean(bPaths.cachedRootDir && containsPath(bPaths.cachedRootDir, fsPath));
    if (aRootContains !== bRootContains) {
      return aRootContains ? -1 : 1;
    }
    if (aRootContains && aPaths.cachedRootDir?.length !== bPaths.cachedRootDir?.length) {
      return (bPaths.cachedRootDir?.length ?? 0) - (aPaths.cachedRootDir?.length ?? 0);
    }

    const aConfigContains = containsPath(aPaths.configDir, fsPath);
    const bConfigContains = containsPath(bPaths.configDir, fsPath);
    if (aConfigContains !== bConfigContains) {
      return aConfigContains ? -1 : 1;
    }
    if (aConfigContains && aPaths.configDir.length !== bPaths.configDir.length) {
      return bPaths.configDir.length - aPaths.configDir.length;
    }

    const aWorkspaceContains = containsPath(aPaths.workspaceDir, fsPath);
    const bWorkspaceContains = containsPath(bPaths.workspaceDir, fsPath);
    if (aWorkspaceContains !== bWorkspaceContains) {
      return aWorkspaceContains ? -1 : 1;
    }

    const aBase = aPaths.cachedRootDir ?? aPaths.configDir;
    const bBase = bPaths.cachedRootDir ?? bPaths.configDir;
    const distance = pathDistance(aBase, fsPath) - pathDistance(bBase, fsPath);
    return distance || aPaths.id.localeCompare(bPaths.id);
  });
}

/** Keeps failed configs visible in the explicit ownership picker. */
export function discoveryPickerCandidates<T extends { id: string }>(
  owning: readonly T[],
  fallback: readonly T[],
  failed: readonly T[],
): T[] {
  const result = new Map<string, T>();
  for (const target of [...(owning.length > 0 ? owning : fallback), ...failed]) {
    result.set(target.id, target);
  }
  return [...result.values()];
}

/**
 * Recognizes only Playwright's complete, expected "No tests found" response.
 * A loose substring match can otherwise hide a real configuration or fixture
 * error that merely mentions those words.
 */
export function isBenignNoTestsFailure(stderr: string, errors: readonly string[]): boolean {
  // Playwright's JSON reporter stores the complete three-line diagnostic in
  // one `errors[].message`, while a missing JSON document contributes our
  // parser fallback as a separate error. Normalize both forms line-by-line.
  const errorLines = errors
    .flatMap((error) => stripAnsi(error).split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean);
  if (errorLines.some((line) => !isExpectedNoTestsErrorLine(line))) {
    return false;
  }

  const stderrLines = stripAnsi(stderr)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (stderrLines.some((line) => !isExpectedNoTestsLine(line))) {
    return false;
  }

  return stderrLines.some(isNoTestsLine) || errorLines.some(isNoTestsLine);
}

export function containsPath(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathDistance(from: string, to: string): number {
  return path.relative(from, to).split(path.sep).filter(Boolean).length;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_SEQUENCE, '');
}

function isExpectedNoTestsErrorLine(line: string): boolean {
  return isExpectedNoTestsLine(line) || line === 'Playwright did not produce a JSON report.';
}

function isExpectedNoTestsLine(line: string): boolean {
  return isNoTestsLine(line)
    || /^Make sure that arguments are regular expressions matching test files\.?$/i.test(line)
    || /^You may need to escape symbols like .+ and quote the arguments\.?$/i.test(line);
}

function isNoTestsLine(line: string): boolean {
  return /^(?:Error:\s*)?No tests found\.?$/i.test(line);
}
