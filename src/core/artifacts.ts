import * as path from 'path';
import { ArtifactKind, ArtifactRecord } from './companionTypes';

/** Recognizes conventional Playwright report and result artifacts by path. */
export function classifyArtifactPath(root: string, file: string): ArtifactKind | undefined {
  const name = path.basename(file).toLowerCase();
  const rootName = path.basename(root).toLowerCase();
  const relative = path.relative(root, file).replaceAll('\\', '/').toLowerCase();
  if (name === 'index.html') {
    return 'report';
  }
  if (!name.endsWith('.zip')) {
    return rootName === 'test-results' || relative.startsWith('test-results/') ? 'attachment' : undefined;
  }
  if (name.includes('trace') || relative.includes('/trace')) {
    return 'trace';
  }
  if (rootName === 'blob-report' || relative.startsWith('blob-report/') || name.includes('blob')) {
    return 'blob-report';
  }
  if (name.includes('report') || relative.startsWith('playwright-report/')) {
    return 'report-zip';
  }
  return rootName === 'test-results' || relative.startsWith('test-results/') ? 'attachment' : undefined;
}

/** Identifies unpacked trace directories without treating arbitrary folders as artifacts. */
export function classifyArtifactDirectory(root: string, directory: string): ArtifactKind | undefined {
  const name = path.basename(directory).toLowerCase();
  const relative = path.relative(root, directory).replaceAll('\\', '/').toLowerCase();
  return name.includes('trace') || relative.includes('/trace') ? 'trace' : undefined;
}

/** Newest-first stable ranking used by the sidebar and latest-artifact actions. */
export function rankArtifacts(records: ArtifactRecord[]): ArtifactRecord[] {
  return [...records].sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path));
}
