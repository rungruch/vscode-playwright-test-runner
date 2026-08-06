/**
 * Requests an available local port for Playwright's long-lived report server.
 * A browser window can be closed while `show-report` keeps serving, so using
 * its fixed default port (9323) would make the next report open fail.
 */
export function buildShowReportArguments(report?: string): string[] {
  return ['show-report', ...(report ? [report] : []), '--port', '0'];
}
