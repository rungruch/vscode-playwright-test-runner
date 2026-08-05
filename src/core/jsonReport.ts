/**
 * Types describing the JSON emitted by `playwright test --list
 * --reporter=json`. Only the fields consumed by the discovery parser are
 * declared; everything else is tolerated and ignored.
 */

export interface JsonReport {
  config?: JsonConfig;
  suites?: JsonSuite[];
  errors?: JsonReportError[];
}

interface JsonConfig {
  rootDir?: string;
  projects?: JsonProject[];
}

interface JsonProject {
  name?: string;
}

interface JsonReportError {
  message?: string;
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
  tags?: string[];
  tests?: JsonTest[];
  id?: string;
  file?: string;
  line?: number;
  column?: number;
}

interface JsonTest {
  projectName?: string;
  expectedStatus?: string;
  status?: string;
}
