import * as vscode from 'vscode';
import { artifactRoots, scanArtifactRoots } from './core/artifactScanner';
import { ArtifactKind, ArtifactRecord } from './core/companionTypes';
import { RunTarget } from './runTarget';
import { Settings } from './settings';

/** Workspace-local, bounded artifact discovery for companion-owned actions. */
export class ArtifactService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<readonly ArtifactRecord[]>();
  private records: ArtifactRecord[] = [];
  private readonly inflight = new Map<string, Promise<ArtifactRecord[]>>();
  private revision = 0;
  private disposed = false;

  readonly onDidChange = this.emitter.event;
  constructor(private readonly scanRoots: typeof scanArtifactRoots = scanArtifactRoots) {}

  get artifacts(): readonly ArtifactRecord[] { return this.records; }

  async scan(targets: readonly RunTarget[]): Promise<readonly ArtifactRecord[]> {
    const roots = artifactRoots(targets.map((target) => ({
      id: target.id, bases: [target.configDir, target.cwd],
      directories: new Settings(vscode.Uri.file(target.configFile ?? target.configDir)).artifactScanDirectories,
    })));
    const key = JSON.stringify([...roots].sort((a, b) => a.path.localeCompare(b.path)));
    const revision = ++this.revision;
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.scanRoots(roots);
      this.inflight.set(key, pending);
      void pending.then(() => this.inflight.delete(key), () => this.inflight.delete(key));
    }
    const records = await pending;
    if (!this.disposed && revision === this.revision) {
      this.records = records;
      this.emitter.fire(this.records);
    }
    return records;
  }

  latest(kind: ArtifactKind | 'reportish'): ArtifactRecord | undefined {
    return this.records.find((record) => kind === 'reportish'
      ? record.kind === 'report' || record.kind === 'report-zip' : record.kind === kind);
  }

  dispose(): void { this.disposed = true; this.emitter.dispose(); }
}
