import * as assert from 'assert';
import { SingleActiveSession } from '../../core/singleActiveSession';

interface FakeHandle {
  name: string;
  dispose(): void;
}

suite('SingleActiveSession', () => {
  test('replaces the active session globally and disposes the previous handle', () => {
    const active = new SingleActiveSession<FakeHandle, string>();
    let firstDisposals = 0;
    const first: FakeHandle = { name: 'ui', dispose: () => { firstDisposals += 1; } };
    const second: FakeHandle = { name: 'inspector', dispose: () => undefined };

    active.replace(() => ({ handle: first, value: 'first target' }));
    active.replace(() => ({ handle: second, value: 'second target' }));

    assert.strictEqual(firstDisposals, 1);
    assert.strictEqual(active.handle, second);
    assert.strictEqual(active.value, 'second target');
  });

  test('ignores a delayed close event from a replaced handle', () => {
    const active = new SingleActiveSession<FakeHandle, string>();
    const first: FakeHandle = { name: 'ui', dispose: () => undefined };
    const second: FakeHandle = { name: 'inspector', dispose: () => undefined };
    active.replace(() => ({ handle: first, value: 'ui' }));
    active.replace(() => ({ handle: second, value: 'inspector' }));

    assert.strictEqual(active.close(first), false);
    assert.strictEqual(active.handle, second);
    assert.strictEqual(active.value, 'inspector');
  });

  test('clears the active session when its handle closes', () => {
    const active = new SingleActiveSession<FakeHandle, string>();
    const handle: FakeHandle = { name: 'ui', dispose: () => undefined };
    active.replace(() => ({ handle, value: 'ui' }));

    assert.strictEqual(active.close(handle), true);
    assert.strictEqual(active.handle, undefined);
    assert.strictEqual(active.value, undefined);
  });
});
