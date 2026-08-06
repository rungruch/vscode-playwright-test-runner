/**
 * Serializes tasks within a group while coalescing an identical pending task.
 * Different groups remain independent.
 */
export class ScopedTaskQueue<T> {
  private readonly tasks = new Map<string, Promise<T>>();
  private readonly tails = new Map<string, Promise<void>>();

  run(group: string, scope: string, task: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([group, scope]);
    const existing = this.tasks.get(key);
    if (existing) {
      return existing;
    }

    const previous = this.tails.get(group) ?? Promise.resolve();
    const running = previous.then(task);
    const tail = running.then(() => undefined, () => undefined);
    this.tasks.set(key, running);
    this.tails.set(group, tail);
    void tail.then(() => {
      if (this.tasks.get(key) === running) {
        this.tasks.delete(key);
      }
      if (this.tails.get(group) === tail) {
        this.tails.delete(group);
      }
    });
    return running;
  }
}
