/** Minimum supported Playwright Test version. */
const MIN_PLAYWRIGHT_VERSION = '1.38.0';

function parseVersion(text: string): [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text ?? '');
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

/** True when `output` (e.g. "Version 1.45.0") reports a supported Playwright. */
export function isSupportedPlaywrightVersion(output: string): boolean {
  const parsed = parseVersion(output);
  if (!parsed) {
    return false;
  }
  const min = parseVersion(MIN_PLAYWRIGHT_VERSION)!;
  return compareVersions(parsed, min) >= 0;
}
