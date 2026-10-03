#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const rootDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reporterPath = path.join(rootDirectory, 'dist', 'companionReporter.cjs');
const eventPrefix = '\u001ePLAYWRIGHT_CODELENS_EVENT:';

await fs.access(reporterPath);

const fixtures = [
  {
    name: 'Playwright 1.62',
    directory: path.join(rootDirectory, 'fixtures', 'basic'),
    args: ['test', 'tests/example.spec.ts', '--workers=5', '--repeat-each=2'],
    expectedTotal: 10,
    minimumConcurrency: 2,
  },
  {
    name: 'Playwright 1.38',
    directory: path.join(rootDirectory, 'fixtures', 'pw138'),
    args: ['test', '--workers=2', '--repeat-each=2'],
    expectedTotal: 2,
    minimumConcurrency: 1,
  },
];

for (const fixture of fixtures) {
  await verifyFixture(fixture);
  await verifyFailureColors(fixture);
}

console.log('Companion reporter compatibility checks passed.');

async function verifyFailureColors(fixture) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playwright-colored-failure-'));
  try {
    const config = path.join(directory, 'playwright.config.cjs');
    await fs.writeFile(config, `module.exports = { testDir: ${JSON.stringify(directory)}, outputDir: ${JSON.stringify(path.join(directory, 'results'))} };`);
    await fs.writeFile(path.join(directory, 'color.spec.js'),
      `const { test, expect } = require(${JSON.stringify(path.join(fixture.directory, 'node_modules', '@playwright', 'test'))});\n`
      + `test('colored assertion failure', () => { expect('actual').toBe('expected'); });\n`);
    const result = await run(process.execPath, [path.join(fixture.directory, 'node_modules', 'playwright', 'cli.js'),
      'test', '--config', config, '--reporter=list'], {
      cwd: fixture.directory,
      env: { ...process.env, FORCE_COLOR: '1', NO_COLOR: undefined, DEBUG_COLORS: undefined, PLAYWRIGHT_FORCE_TTY: '0' },
    });
    assert.equal(result.code, 1, `${fixture.name} intentional assertion failure`);
    assert.ok(result.stdout.includes('Expected:') && result.stdout.includes('Received:'), `${fixture.name} assertion diff`);
    assert.ok(result.stdout.includes('toBe') && result.stdout.includes('color.spec.js'), `${fixture.name} source code frame`);
    assert.ok(result.stdout.includes('\x1b[31m'), `${fixture.name} red failure output`);
    assert.ok(result.stdout.includes('\x1b[32m'), `${fixture.name} green expected value`);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function verifyFixture(fixture) {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'playwright-codelens-reporter-test-'));
  try {
    const cliPath = path.join(fixture.directory, 'node_modules', 'playwright', 'cli.js');
    const runId = `reporter-${path.basename(temporaryDirectory)}`;
    const resultFile = path.join(temporaryDirectory, 'result.json');
    const result = await run(process.execPath, [
      cliPath,
      ...fixture.args,
      `--reporter=list,json,${reporterPath}`,
    ], {
      cwd: fixture.directory,
      env: {
        ...process.env,
        PLAYWRIGHT_CODELENS_RUN_ID: runId,
        FORCE_COLOR: '1',
        NO_COLOR: undefined,
        DEBUG_COLORS: undefined,
        PLAYWRIGHT_FORCE_TTY: '0',
        PLAYWRIGHT_JSON_OUTPUT_NAME: resultFile,
      },
    });

    assert.equal(result.code, 0, `${fixture.name} run failed:\n${result.stderr}\n${result.stdout}`);
    assert.ok(result.stdout.includes('\x1b['), `${fixture.name} preserves reporter colors`);
    assert.ok(!new RegExp(`${String.fromCharCode(27)}\\[\\d*[AFGK]`).test(result.stdout), `${fixture.name} does not rewrite completed lines`);
    const events = reporterEvents(result.stdout, runId);
    const plan = events.filter((event) => event.type === 'plan');
    const begins = events.filter((event) => event.type === 'testBegin');
    const ends = events.filter((event) => event.type === 'testEnd');
    assert.equal(plan.length, 1, `${fixture.name} must emit one plan event`);
    assert.equal(plan[0].total, fixture.expectedTotal, `${fixture.name} plan total`);
    assert.equal(begins.length, fixture.expectedTotal, `${fixture.name} begin count`);
    assert.equal(ends.length, fixture.expectedTotal, `${fixture.name} end count`);
    assert.ok(maximumConcurrency(events) >= fixture.minimumConcurrency, `${fixture.name} concurrency events`);
    await fs.access(resultFile);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function run(executable, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => (stdout += data.toString('utf8')));
    child.stderr.on('data', (data) => (stderr += data.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function reporterEvents(output, runId) {
  const events = [];
  for (const fragment of output.split(eventPrefix).slice(1)) {
    const lineEnd = fragment.indexOf('\n');
    if (lineEnd < 0) {
      continue;
    }
    const event = JSON.parse(fragment.slice(0, lineEnd));
    if (event.version === 1 && event.runId === runId) {
      events.push(event);
    }
  }
  return events;
}

function maximumConcurrency(events) {
  let active = 0;
  let maximum = 0;
  for (const event of events) {
    if (event.type === 'testBegin') {
      active++;
      maximum = Math.max(maximum, active);
    } else if (event.type === 'testEnd') {
      active--;
    }
  }
  return maximum;
}
