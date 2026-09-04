import { RunSelection } from './runArguments';

export type CompanionTestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'flaky' | 'skipped';

export interface CompanionTestItem {
  id: string;
  title: string;
  file?: string;
  line?: number;
  status: CompanionTestStatus;
  durationMs?: number;
  message?: string;
  project?: string;
  totalRuns?: number;
  passedRuns?: number;
  failedRuns?: number;
}

/** A structured, extension-owned CLI invocation. */
export interface CompanionCliRunRequest {
  kind: 'flake-lab' | 'rerun-failed' | 'companion-run';
  targetId: string;
  cwd: string;
  configFile?: string;
  args: string[];
  env: Record<string, string>;
  /** Retained so a failed run can be narrowed and launched again safely. */
  selection: RunSelection;
  projects: string[];
  startedAt?: number;
  initialTests?: CompanionTestItem[];
  repeatEach?: number;
}

type CompanionRunStatus = 'running' | 'passed' | 'failed' | 'cancelled' | 'incomplete';

export interface CompanionFailure {
  title: string;
  file?: string;
  line?: number;
  message?: string;
  /** Full title path when Playwright's JSON reporter provides it. */
  titlePath?: string[];
}

export interface CompanionRunSummary {
  id: string;
  kind: CompanionCliRunRequest['kind'];
  targetId: string;
  configFile?: string;
  cwd: string;
  status: CompanionRunStatus;
  startedAt: number;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  failures: CompanionFailure[];
  args: string[];
  selection: RunSelection;
  projects: string[];
  currentTest?: string;
  tests?: CompanionTestItem[];
  output?: string;
  completedTests?: number;
  repeatEach?: number;
}

export interface UiProfile {
  name: string;
  host: string;
  port: number;
}

export type ArtifactKind = 'report' | 'report-zip' | 'trace' | 'blob-report' | 'attachment';

export interface ArtifactRecord {
  kind: ArtifactKind;
  path: string;
  label: string;
  modifiedAt: number;
  targetId: string;
}
