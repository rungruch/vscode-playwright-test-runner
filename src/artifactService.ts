import * as fs from 'fs/promises';
import { Dirent } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { classifyArtifactDirectory, classifyArtifactPath, rankArtifacts } from './core/artifacts';
import { ArtifactKind, ArtifactRecord } from './core/companionTypes';
import { RunTarget } from './runTarget';
import { Settings } from './settings';

const MAX_ARTIFACT_FILES = 5_000;
const MAX_ARTIFACT_DEPTH = 8;

/** Workspace-local, bounded artifact discovery for companion-owned actions. */
export class ArtifactService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<readonly ArtifactRecord[]>();
  private records: ArtifactRecord[] = [];

  readonly onDidChange = this.emitter.event;

  get artifacts(): readonly ArtifactRecord[] {
    return this.records;
  }

  async scan(targets: readonly RunTarget[]): Promise<readonly ArtifactRecord[]> {
    const found: ArtifactRecord[] = [];
    for (const target of targets) {
      const resource = vscode.Uri.file(target.configFile ?? target.configDir);
      const directories = new Settings(resource).artifactScanDirectories;
      const bases = [...new Set([target.configDir, target.cwd])];
      for (const base of bases) {
        for (const directory of directories) {
          const root = path.resolve(base, directory);
          if (!isWithin(base, root)) {
            continue;
          }
          await scanRoot(root, target, found);
        }
      }
    }
    const unique = new Map(found.map((record) => [`${record.kind}\0${record.path}`, record]));
    this.records = rankArtifacts([...unique.values()]);
    this.emitter.fire(this.records);
    return this.records;
  }

  latest(kind: ArtifactKind | 'reportish'): ArtifactRecord | undefined {
    return this.records.find((record) => kind === 'reportish'
      ? record.kind === 'report' || record.kind === 'report-zip'
      : record.kind === kind);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

async function scanRoot(root: string, target: RunTarget, records: ArtifactRecord[]): Promise<void> {
  const pending: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  let seen = 0;
  while (pending.length > 0 && seen < MAX_ARTIFACT_FILES) {
    const current = pending.pop()!;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (seen++ >= MAX_ARTIFACT_FILES || entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      const file = path.join(current.directory, entry.name);
      if (entry.isDirectory()) {
        const kind = classifyArtifactDirectory(root, file);
        if (kind) {
          await addRecord(records, kind, file, target);
        }
        if (current.depth < MAX_ARTIFACT_DEPTH) {
          pending.push({ directory: file, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const kind = classifyArtifactPath(root, file);
      if (!kind) {
        continue;
      }
      await addRecord(records, kind, file, target);
    }
  }
}

async function addRecord(
  records: ArtifactRecord[],
  kind: ArtifactKind,
  file: string,
  target: RunTarget,
): Promise<void> {
  try {
    const stat = await fs.stat(file);
    records.push({
      kind,
      path: kind === 'report' ? path.dirname(file) : file,
      label: labelFor(kind, file),
      modifiedAt: stat.mtimeMs,
      targetId: target.id,
    });
  } catch {
    // The file can disappear during a test run; the next refresh retries.
  }
}

function labelFor(kind: ArtifactKind, file: string): string {
  const prefix = kind === 'report' ? 'HTML report' : kind === 'report-zip' ? 'Report ZIP'
    : kind === 'trace' ? 'Trace' : kind === 'blob-report' ? 'Blob report' : 'Attachment';
  return `${prefix}: ${path.basename(kind === 'report' ? path.dirname(file) : file)}`;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
