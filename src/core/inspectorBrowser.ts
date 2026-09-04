export type BrowserPreference = 'config' | 'chromium' | 'firefox' | 'webkit';
export type ForcedBrowser = Exclude<BrowserPreference, 'config'>;

export interface BrowserResolution {
  projects: string[];
  browser?: ForcedBrowser;
  error?: string;
}

/**
 * Resolves a browser preference without passing Playwright's incompatible
 * `--browser` and configured-project options together.
 */
export function resolveBrowserPreference(
  preference: BrowserPreference,
  selectedProjects: readonly string[],
  availableProjects: readonly string[] | undefined,
): BrowserResolution {
  if (preference === 'config') {
    return { projects: [...selectedProjects] };
  }

  if (availableProjects === undefined) {
    return {
      projects: [],
      error: `Cannot force ${preference} because Playwright projects could not be discovered.`,
    };
  }

  const prefLower = preference.toLocaleLowerCase();
  const exactMatch = availableProjects.find(
    (project) => project.toLocaleLowerCase() === prefLower,
  );
  if (exactMatch) {
    return { projects: [exactMatch] };
  }

  const aliasMatch = availableProjects.find((project) => {
    const lower = project.toLocaleLowerCase();
    if (prefLower === 'chromium') {
      return lower === 'chrome' || lower.includes('chromium') || lower.includes('chrome');
    }
    if (prefLower === 'firefox') {
      return lower.includes('firefox');
    }
    if (prefLower === 'webkit') {
      return lower === 'safari' || lower.includes('webkit') || lower.includes('safari');
    }
    return false;
  });
  if (aliasMatch) {
    return { projects: [aliasMatch] };
  }

  if (availableProjects.length === 0) {
    return { projects: [], browser: preference };
  }

  return {
    projects: [],
    error: `Cannot force ${preference}: this Playwright config has no project named "${preference}".`,
  };
}

export function isBrowserPreference(value: string): value is BrowserPreference {
  return value === 'config' || value === 'chromium' || value === 'firefox' || value === 'webkit';
}

