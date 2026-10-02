import * as fs from 'fs/promises';
import { Dirent } from 'fs';
import * as path from 'path';
import { classifyArtifactDirectory, classifyArtifactPath, rankArtifacts } from './artifacts';
import { ArtifactKind, ArtifactRecord } from './companionTypes';

interface ArtifactTarget { id: string; bases: string[]; directories: string[] }
interface ScanRoot { path: string; targetIds: string[] }
interface ArtifactFileSystem {
  readDirectory(directory: string): Promise<Dirent[]>;
  stat(file: string): Promise<{ mtimeMs: number }>;
}

/** Deduplicate I/O roots while retaining every config associated with them. */
export function artifactRoots(targets: readonly ArtifactTarget[]): ScanRoot[] {
  const roots = new Map<string, Set<string>>();
  for (const target of targets) {
    for (const base of target.bases) {
      for (const directory of target.directories) {
        const root = path.resolve(base, directory);
        const relative = path.relative(base, root);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) { continue; }
        const owners = roots.get(root) ?? new Set<string>();
        owners.add(target.id);
        roots.set(root, owners);
      }
    }
  }
  return [...roots].map(([path, owners]) => ({ path, targetIds: [...owners].sort() }));
}

/** Bounded scan; filesystem injection enables assertions about actual I/O. */
export async function scanArtifactRoots(
  roots: readonly ScanRoot[],
  io: ArtifactFileSystem = { readDirectory: (directory) => fs.readdir(directory, { withFileTypes: true }), stat: fs.stat },
): Promise<ArtifactRecord[]> {
  const records = new Map<string, ArtifactRecord>();
  for (const root of roots) {
    const pending = [{ directory: root.path, depth: 0 }];
    let seen = 0;
    while (pending.length > 0 && seen < 5_000) {
      const current = pending.pop()!;
      let entries: Dirent[];
      try { entries = await io.readDirectory(current.directory); } catch { continue; }
      for (const entry of entries) {
        if (seen++ >= 5_000 || entry.name === 'node_modules' || entry.name === '.git') { continue; }
        const file = path.join(current.directory, entry.name);
        let kind: ArtifactKind | undefined;
        if (entry.isDirectory()) {
          kind = classifyArtifactDirectory(root.path, file);
          if (current.depth < 8) { pending.push({ directory: file, depth: current.depth + 1 }); }
        } else if (entry.isFile()) {
          kind = classifyArtifactPath(root.path, file);
        }
        if (!kind) { continue; }
        try {
          const stat = await io.stat(file);
          const artifactPath = kind === 'report' ? path.dirname(file) : file;
          const key = `${kind}\0${artifactPath}`;
          const existing = records.get(key);
          const targetIds = [...new Set([...(existing?.targetIds ?? []), ...root.targetIds])].sort();
          const prefix = kind === 'report' ? 'HTML report' : kind === 'report-zip' ? 'Report ZIP'
            : kind === 'trace' ? 'Trace' : kind === 'blob-report' ? 'Blob report' : 'Attachment';
          records.set(key, { kind, path: artifactPath, label: `${prefix}: ${path.basename(artifactPath)}`,
            modifiedAt: stat.mtimeMs, targetId: targetIds[0], targetIds });
        } catch { /* Files can disappear while a test run writes artifacts. */ }
      }
    }
  }
  return rankArtifacts([...records.values()]);
}
