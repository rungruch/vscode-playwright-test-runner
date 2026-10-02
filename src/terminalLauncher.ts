import crossSpawn from 'cross-spawn';

// VS Code starts this bundled relay directly, independent of the user's shell.
// cross-spawn handles Windows .cmd shims without losing argv boundaries.
const [executable, ...args] = process.argv.slice(2);
if (!executable) {
  process.stderr.write('No Playwright executable was supplied.\n');
  process.exitCode = 1;
} else {
  const child = crossSpawn(executable, args, { stdio: 'inherit', shell: false });
  child.on('error', (error) => {
    process.stderr.write(`Failed to start ${executable}: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
  process.on('SIGINT', () => { child.kill('SIGINT'); });
  process.on('SIGTERM', () => { child.kill('SIGTERM'); });
}
