import { EditorTestSelection, editorSelectionsForFile } from './editorSelections';
import { DiscoveredConfig } from './model';
import { verifyEditorSelection } from './selectionVerification';

interface SelectionDocument {
  readonly version: number;
  readonly isDirty: boolean;
  save(): PromiseLike<boolean>;
}

interface PreparationServices<T extends { id: string }> {
  openDocument(): PromiseLike<SelectionDocument>;
  afterSave?(): Promise<void>;
  resolveTarget(): Promise<T | undefined>;
  discover(target: T): Promise<DiscoveredConfig | undefined>;
  revision(target: T): number;
}

/** Keeps saving, async discovery, and stale-selection checks in one execution gate. */
export async function prepareSelection<T extends { id: string }>(
  requested: EditorTestSelection,
  services: PreparationServices<T>,
): Promise<{ target: T; selection: EditorTestSelection; error?: undefined } | { error: string; reason?: 'missing' }> {
  const document = await services.openDocument();
  if (requested.documentVersion !== undefined && requested.documentVersion !== document.version) {
    return { error: 'This test selection changed. Choose its current CodeLens action again.' };
  }
  const needsSave = document.isDirty;
  if (needsSave) {
    if (!(await document.save())) {
      return { error: 'Save the selected test file before running its companion action.' };
    }
  }
  const version = document.version;
  if (needsSave) {
    await services.afterSave?.();
  }
  const target = await services.resolveTarget();
  if (!target) {
    return { error: 'No owning Playwright configuration is available for this test.' };
  }
  const revision = services.revision(target);
  const model = await services.discover(target);
  if (!model || model.errors.length > 0 || document.isDirty || document.version !== version || services.revision(target) !== revision) {
    return { error: 'Could not verify the current test selection. Retry after discovery finishes.' };
  }
  const candidates = editorSelectionsForFile(model, requested.file, requested.uri);
  const selection = verifyEditorSelection(requested, candidates);
  if (!selection) {
    const titles = requested.titlePaths ?? (requested.titlePath ? [requested.titlePath] : []);
    const stillPresent = candidates.some((candidate) => candidate.kind === requested.kind
      && (candidate.titlePaths ?? (candidate.titlePath ? [candidate.titlePath] : []))
        .some((path) => titles.some((title) => JSON.stringify(title) === JSON.stringify(path))));
    return { error: 'The selected declaration is no longer available. Choose its current CodeLens action again.',
      reason: titles.length > 0 && !stillPresent ? 'missing' : undefined };

  }
  return { target, selection: {
    ...selection, discoverySource: 'cli', documentVersion: version, discoveryRevision: revision,
  } };
}
