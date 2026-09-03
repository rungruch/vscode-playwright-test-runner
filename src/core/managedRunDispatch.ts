export interface ManagedRunDispatch<T> {
  runsEnabled: boolean;
  runManaged(): Promise<T>;
  runInTerminal(): void;
  afterManaged(): Promise<void>;
}

/** Selects managed reporting or the terminal-only fallback for companion runs. */
export async function dispatchManagedRun<T>(options: ManagedRunDispatch<T>): Promise<T | undefined> {
  if (!options.runsEnabled) {
    options.runInTerminal();
    return undefined;
  }
  const result = await options.runManaged();
  await options.afterManaged();
  return result;
}
