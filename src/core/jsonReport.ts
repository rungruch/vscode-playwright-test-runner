/**
 * Types describing the JSON emitted by `playwright test --list --reporter=json`
 * (and by `playwright test --reporter=json`). Only the fields consumed by the
 * extension are declared; everything else is tolerated and ignored.
 */

export interface JsonReport {
  config?: JsonConfig;
  suites?: JsonSuite[];
  errors?: JsonReportError[];
  stats?: unknown;
}

export interface JsonConfig {
  rootDir?: string;
  configFile?: string;
  projects?: JsonProject[];
}

export interface JsonProject {
  name?: string;
  testDir?: string;
  testMatch?: string | string[];
  testIgnore?: string | string[];
}

export interface JsonReportError {
  message?: string;
  stack?: string;
  location?: JsonLocation;
}

export interface JsonLocation {
  file?: string;
  line?: number;
  column?: number;
}

export interface JsonSuite {
  title?: string;
  file?: string;
  line?: number;
  column?: number;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}

export interface JsonSpec {
  title?: string;
  ok?: boolean;
  tags?: string[];
  tests?: JsonTest[];
  id?: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface JsonTest {
  timeout?: number;
  annotations?: { type?: string; description?: string }[];
  expectedStatus?: string;
  projectId?: string;
  projectName?: string;
  status?: string;
  results?: JsonTestResult[];
}

export interface JsonTestResult {
  status?: string;
  duration?: number;
  errors?: JsonReportError[];
  error?: JsonReportError;
  attachments?: JsonAttachment[];
  stdout?: (string | { text?: string })[];
  stderr?: (string | { text?: string })[];
}

export interface JsonAttachment {
  name?: string;
  contentType?: string;
  path?: string;
  body?: string;
}
