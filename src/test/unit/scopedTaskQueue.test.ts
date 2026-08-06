import * as assert from 'assert';
import { ScopedTaskQueue } from '../../core/scopedTaskQueue';

suite('ScopedTaskQueue', () => {
  test('coalesces an identical scope and serializes different scopes in one group', async () => {
    const queue = new ScopedTaskQueue<string>();
    const gate = deferred<void>();
    const events: string[] = [];
    let duplicateRuns = 0;

    const first = queue.run('target', 'full', async () => {
      events.push('first:start');
      await gate.promise;
      events.push('first:end');
      return 'first';
    });
    const duplicate = queue.run('target', 'full', async () => {
      duplicateRuns++;
      return 'duplicate';
    });
    const second = queue.run('target', 'file', async () => {
      events.push('second');
      return 'second';
    });

    assert.strictEqual(first, duplicate);
    await Promise.resolve();
    assert.deepStrictEqual(events, ['first:start']);
    gate.resolve();
    assert.deepStrictEqual(await Promise.all([first, duplicate, second]), ['first', 'first', 'second']);
    assert.strictEqual(duplicateRuns, 0);
    assert.deepStrictEqual(events, ['first:start', 'first:end', 'second']);
  });

  test('allows different groups to run independently', async () => {
    const queue = new ScopedTaskQueue<void>();
    const gate = deferred<void>();
    let otherGroupStarted = false;

    const blocked = queue.run('target-a', 'full', () => gate.promise);
    const independent = queue.run('target-b', 'full', async () => {
      otherGroupStarted = true;
    });
    await independent;
    assert.strictEqual(otherGroupStarted, true);
    gate.resolve();
    await blocked;
  });
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
