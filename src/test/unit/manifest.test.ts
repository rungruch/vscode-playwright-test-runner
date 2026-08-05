import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('extension manifest', () => {
  test('activates custom configured layouts after startup', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
      activationEvents?: string[];
    };
    assert.ok(manifest.activationEvents?.includes('onStartupFinished'));
  });
});
