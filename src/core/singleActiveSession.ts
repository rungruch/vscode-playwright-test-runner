export interface DisposableSessionHandle {
  dispose(): void;
}

interface ActiveSession<THandle, TValue> {
  handle: THandle;
  value: TValue;
}

/** Owns one replaceable disposable session and ignores stale close events. */
export class SingleActiveSession<THandle extends DisposableSessionHandle, TValue> {
  private current: ActiveSession<THandle, TValue> | undefined;

  get handle(): THandle | undefined {
    return this.current?.handle;
  }

  get value(): TValue | undefined {
    return this.current?.value;
  }

  replace(create: () => ActiveSession<THandle, TValue>): void {
    const previous = this.current;
    this.current = undefined;
    previous?.handle.dispose();
    this.current = create();
  }

  close(handle: THandle): boolean {
    if (this.current?.handle !== handle) {
      return false;
    }
    this.current = undefined;
    return true;
  }

  dispose(): void {
    const current = this.current;
    this.current = undefined;
    current?.handle.dispose();
  }
}
