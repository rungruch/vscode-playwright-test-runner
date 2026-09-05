import { CompanionTestStatus } from './companionTypes';

/** Playwright's outcome includes expected failures and unexpected passes. */
export function terminalTestStatus(outcome: string | undefined, status: string | undefined, recovered = false): CompanionTestStatus {
  if (outcome === 'unexpected') {
    return 'failed';
  }
  if (outcome === 'skipped' || status === 'skipped') {
    return 'skipped';
  }
  if (outcome === 'flaky' || (recovered && status === 'passed')) {
    return 'flaky';
  }
  return outcome === 'expected' || status === 'passed' ? 'passed' : 'failed';
}
