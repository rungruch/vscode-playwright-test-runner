import * as assert from 'assert';
import { quoteForTerminal } from '../../core/terminalQuote';

suite('terminalQuote', () => {
  test('leaves safe tokens unquoted on posix', () => {
    assert.strictEqual(quoteForTerminal('npx', ['playwright', 'test'], 'darwin'), 'npx playwright test');
  });

  test('single-quotes paths with spaces on posix', () => {
    assert.strictEqual(
      quoteForTerminal('npx', ['playwright', 'show-trace', '/tmp/my traces/a b.zip'], 'linux'),
      "npx playwright show-trace '/tmp/my traces/a b.zip'",
    );
  });

  test('escapes embedded single quotes on posix', () => {
    assert.strictEqual(
      quoteForTerminal('cmd', ["it's"], 'linux'),
      `'cmd' 'it'\\''s'`.replace("'cmd'", 'cmd'),
    );
  });

  test('uses the PowerShell call operator and literal quoting on Windows', () => {
    assert.strictEqual(
      quoteForTerminal('npx.cmd', ['playwright', 'C:\\my dir\\trace.zip'], 'win32'),
      "& 'npx.cmd' 'playwright' 'C:\\my dir\\trace.zip'",
    );
    assert.strictEqual(quoteForTerminal('C:\\Program Files\\node.exe', ["it's", '$x;&'], 'win32', 'pwsh.exe'),
      "& 'C:\\Program Files\\node.exe' 'it''s' '$x;&'");
  });
});
