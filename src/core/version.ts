/** Minimum supported Playwright Test version. */
const MIN_PLAYWRIGHT_VERSION = '1.38.0';
/** `--fail-on-flaky-tests` was added in Playwright Test 1.52. */
const FAIL_ON_FLAKY_TESTS_VERSION = '1.52.0';

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
  return isPlaywrightVersionAtLeast(output, MIN_PLAYWRIGHT_VERSION);
}

/** True when a Playwright version string meets the supplied semantic floor. */
function isPlaywrightVersionAtLeast(output: string, minimum: string): boolean {
  const parsed = parseVersion(output);
  const min = parseVersion(minimum);
  return Boolean(parsed && min && compareVersions(parsed, min) >= 0);
}

/** Whether the CLI supports the `--fail-on-flaky-tests` flag. */
export function supportsFailOnFlakyTests(output: string): boolean {
  return isPlaywrightVersionAtLeast(output, FAIL_ON_FLAKY_TESTS_VERSION);
}
