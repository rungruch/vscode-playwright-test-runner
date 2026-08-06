import { EditorTestSelection } from './editorSelections';

export const OFFICIAL_PLAYWRIGHT_EXTENSION_ID = 'ms-playwright.playwright';

export type OfficialRunMode = 'run' | 'debug';

export interface OfficialCommandInvocation {
  command: string;
  usesUri: boolean;
  usesCursor: boolean;
}

export function officialCommandFor(
  selection: EditorTestSelection,
  mode: OfficialRunMode,
): OfficialCommandInvocation {
  if (selection.kind === 'file') {
    return {
      command: mode === 'run' ? 'testing.run.uri' : 'testing.debug.uri',
      usesUri: true,
      usesCursor: false,
    };
  }
  return {
    command: mode === 'run' ? 'testing.runAtCursor' : 'testing.debugAtCursor',
    usesUri: false,
    usesCursor: true,
  };
}

export function officialIntegrationError(
  extensionInstalled: boolean,
  commands: ReadonlySet<string>,
  requiredCommand: string,
): string | undefined {
  if (!extensionInstalled) {
    return `The required ${OFFICIAL_PLAYWRIGHT_EXTENSION_ID} extension is not installed.`;
  }
  if (!commands.has(requiredCommand)) {
    return `VS Code command ${requiredCommand} is unavailable. Update VS Code and ${OFFICIAL_PLAYWRIGHT_EXTENSION_ID}.`;
  }
  return undefined;
}
