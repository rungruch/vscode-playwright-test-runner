/**
 * Internal discovery model produced from the Playwright `--list --reporter=json`
 * output. The tree is: config -> file -> suite -> test. IDs are stable across
 * discoveries so CodeLens selections remain predictable across refreshes.
 */

export interface DiscoveredLocation {
  file: string;
  line: number;
  column: number;
}

export interface DiscoveredTest {
  /** Stable id: Playwright spec id (unique per spec, survives duplicate titles). */
  id: string;
  title: string;
  /** Full title including describe paths, used for --grep filters. */
  fullTitle: string;
  location: DiscoveredLocation;
  /** Names of the Playwright projects this spec runs under. */
  projects: string[];
  tags: string[];
  skipped: boolean;
}

export interface DiscoveredSuite {
  id: string;
  title: string;
  location?: DiscoveredLocation;
  suites: DiscoveredSuite[];
  tests: DiscoveredTest[];
}

export interface DiscoveredFile {
  /** Stable id derived from the file path relative to the config root. */
  id: string;
  /** Absolute file path. */
  file: string;
  /** File path relative to the config root dir, used as the display label. */
  relativeFile: string;
  suites: DiscoveredSuite[];
  tests: DiscoveredTest[];
}

export interface DiscoveredConfig {
  /** Stable id derived from the absolute config path (or cwd for configless projects). */
  id: string;
  /** Absolute path of the Playwright config file, or undefined for configless projects. */
  configFile?: string;
  /** Directory the Playwright CLI runs in for this config. */
  cwd: string;
  /** Playwright rootDir reported by discovery, defaults to cwd. */
  rootDir: string;
  /** Project names known to this config (empty until first discovery). */
  projects: string[];
  files: DiscoveredFile[];
  /** Errors reported by the JSON reporter during discovery. */
  errors: string[];
}

export function isSkippedStatus(status: string | undefined): boolean {
  return status === 'skipped';
}
