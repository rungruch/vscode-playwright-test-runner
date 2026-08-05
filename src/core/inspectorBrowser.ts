export type InspectorBrowser = 'config' | 'chromium' | 'firefox' | 'webkit';
export type ForcedInspectorBrowser = Exclude<InspectorBrowser, 'config'>;

export interface InspectorBrowserResolution {
  projects: string[];
  browser?: ForcedInspectorBrowser;
  error?: string;
}

/**
 * Resolves an Inspector-only browser preference without passing Playwright's
 * incompatible `--browser` and configured-project options together.
 */
export function resolveInspectorBrowser(
  preference: InspectorBrowser,
  selectedProjects: readonly string[],
  availableProjects: readonly string[] | undefined,
): InspectorBrowserResolution {
  if (preference === 'config') {
    return { projects: [...selectedProjects] };
  }

  if (availableProjects === undefined) {
    return {
      projects: [],
      error: `Cannot force ${preference} because Playwright projects could not be discovered.`,
    };
  }

  const matchingProject = availableProjects.find(
    (project) => project.toLocaleLowerCase() === preference,
  );
  if (matchingProject) {
    return { projects: [matchingProject] };
  }

  if (availableProjects.length === 0) {
    return { projects: [], browser: preference };
  }

  return {
    projects: [],
    error: `Cannot force ${preference}: this Playwright config has no project named "${preference}".`,
  };
}

export function isInspectorBrowser(value: string): value is InspectorBrowser {
  return value === 'config' || value === 'chromium' || value === 'firefox' || value === 'webkit';
}
