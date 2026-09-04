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
}

console.log('Companion reporter compatibility checks passed.');

async function verifyFixture(fixture) {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'playwright-codelens-reporter-test-'));
  try {
    const cliPath = path.join(fixture.directory, 'node_modules', 'playwright', 'cli.js');
    const runId = `reporter-${path.basename(temporaryDirectory)}`;
    const resultFile = path.join(temporaryDirectory, 'result.json');
    const result = await run(process.execPath, [
      cliPath,
      ...fixture.args,
      `--reporter=line,json,${reporterPath}`,
    ], {
      cwd: fixture.directory,
      env: {
        ...process.env,
        PLAYWRIGHT_CODELENS_RUN_ID: runId,
        PLAYWRIGHT_JSON_OUTPUT_NAME: resultFile,
      },
    });

    assert.equal(result.code, 0, `${fixture.name} run failed:\n${result.stderr}\n${result.stdout}`);
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
