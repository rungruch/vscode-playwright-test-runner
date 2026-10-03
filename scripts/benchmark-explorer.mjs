#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { explorerResults: before } = require('../benchmarks/baselines/explorer-results-before.cjs');
const { ExplorerResultProjector } = await loadCandidate();
const { explorerTree } = require('../out/core/explorerTree.js');
const { values } = parseArgs({ options: {
  sizes: { type: 'string', default: '1000,10000,30000' },
  samples: { type: 'string', default: '31' },
  warmup: { type: 'string', default: '8' },
  output: { type: 'string' },
} });
const sizes = values.sizes.split(',').map(Number);
const samples = Number(values.samples);
const warmup = Number(values.warmup);
assert.ok([...sizes, samples].every(value => Number.isInteger(value) && value > 0));
assert.ok(Number.isInteger(warmup) && warmup >= 0);
const cases = ['cold-full', 'live-full', 'live-narrow-rerun', 'inventory-replaced', 'empty-history'];
const rows = [];

for (const count of sizes) {
  for (const scenario of cases) {
    const fixture = makeFixture(count, scenario);
    let projector = new ExplorerResultProjector();
    const times = { before: [], after: [] };
    for (let iteration = 0; iteration < warmup + samples; iteration++) {
      const { nodes, runs } = fixture.next(iteration);
      if (scenario === 'cold-full') { projector = new ExplorerResultProjector(); }
      const outputs = {};
      // Alternate execution order to reduce JIT, GC, and temperature bias.
      for (const side of iteration % 2 ? ['after', 'before'] : ['before', 'after']) {
        const start = performance.now();
        outputs[side] = side === 'before' ? before(nodes, runs) : projector.project(nodes, runs);
        const elapsed = performance.now() - start;
        if (iteration >= warmup) { times[side].push(elapsed); }
      }
      // Full semantic equivalence is checked after (and outside) every timed call.
      assert.deepStrictEqual(outputs.after, outputs.before, `${scenario}, ${count} tests, snapshot ${iteration}`);
      if (scenario !== 'empty-history') {
        assert.ok(outputs.after.size >= count, 'every inventory test has a retained result');
      } else {
        assert.equal(outputs.after.size, 0);
      }
    }
    const baseline = statistics(times.before);
    const optimized = statistics(times.after);
    rows.push({ tests: count, scenario, before: baseline, after: optimized,
      speedup: baseline.medianMs / optimized.medianMs,
      reductionPercent: 100 * (1 - optimized.medianMs / baseline.medianMs) });
    console.log(`${count.toLocaleString('en-US')} tests / ${scenario}: ${baseline.medianMs.toFixed(3)} → ${optimized.medianMs.toFixed(3)} ms median`);
  }
}

const hashes = {};
for (const file of ['benchmarks/baselines/explorer-results-before.cjs', 'src/core/explorerResults.ts',
  'src/core/testIdentity.ts', 'src/core/explorerTree.ts', 'scripts/benchmark-explorer.mjs']) {
  hashes[file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
}
const report = {
  capturedAt: new Date().toISOString(),
  environment: { node: process.version, esbuild: esbuildVersion, platform: process.platform, arch: process.arch,
    osRelease: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
  methodology: { warmup, samples, order: 'alternating before/after', unit: 'milliseconds',
    assertion: 'deepStrictEqual of the entire result map on every snapshot, outside timing',
    liveUpdates: 'new summary and test array each snapshot; 1% of active rows change status/duration',
    fixture: '3 retained runs; 100 tests/file; 4 cases/declaration; legacy and missing-column rows included',
    scope: 'result projection only; excludes fixture construction, Playwright CLI, filesystem I/O, and VS Code rendering' },
  hashes, results: rows,
};
console.table(rows.map(row => ({ tests: row.tests, scenario: row.scenario,
  beforeMedianMs: +row.before.medianMs.toFixed(3), afterMedianMs: +row.after.medianMs.toFixed(3),
  beforeP95Ms: +row.before.p95Ms.toFixed(3), afterP95Ms: +row.after.p95Ms.toFixed(3), speedup: +row.speedup.toFixed(2) })));
if (values.output) {
  await fs.writeFile(path.resolve(values.output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Raw samples and environment: ${values.output}`);
}

function statistics(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    minMs: sorted[0], maxMs: sorted.at(-1), samplesMs: times };
}

async function loadCandidate() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playwright-explorer-benchmark-'));
  try {
    const outfile = path.join(directory, 'candidate.cjs');
    await build({ entryPoints: [path.join(root, 'src/core/explorerResults.ts')], outfile,
      bundle: true, platform: 'node', format: 'cjs', target: 'es2022' });
    return require(outfile);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function makeFixture(count, scenario) {
  const cwd = path.resolve(os.tmpdir(), 'playwright-explorer-benchmark');
  const tests = Array.from({ length: count }, (_, index) => ({
    id: `case-${index}`, title: `suite › case ${index}`, titlePath: index % 20 ? ['suite', `case ${index}`] : undefined,
    file: path.join(cwd, 'tests', `group-${Math.floor(index / 1000)}`, `file-${Math.floor(index / 100)}.spec.ts`),
    line: 2 + Math.floor((index % 100) / 4), column: index % 25 ? 1 : undefined,
    status: 'passed', durationMs: 1, totalRuns: 1, completedRuns: 1, activeRuns: 0,
  }));
  const files = new Map();
  for (const [index, test] of tests.entries()) {
    let file = files.get(test.file);
    if (!file) {
      file = { id: `file:${test.file}`, file: test.file, relativeFile: path.relative(cwd, test.file), tests: [],
        suites: [{ id: `suite:${test.file}`, title: 'suite', location: { file: test.file, line: 1, column: 1 }, suites: [], tests: [] }] };
      files.set(test.file, file);
    }
    file.suites[0].tests.push({ id: test.id, title: `case ${index}`, fullTitle: `suite case ${index}`,
      location: { file: test.file, line: test.line, column: 1 }, projects: [], tags: [], skipped: false });
  }
  const model = { id: 'config', cwd, rootDir: cwd, projects: [], errors: [], files: [...files.values()] };
  const tree = revision => explorerTree(model, revision, file => `file://${file}`);
  const nodes = tree(0);
  const run = (id, startedAt, items, status = 'passed') => ({
    id, startedAt, tests: items, status, targetId: model.id, cwd, kind: 'companion-run', durationMs: 1,
    total: items.length, passed: items.length, failed: 0, skipped: 0, flaky: 0, failures: [],
    args: [], projects: [], selection: { files: [], titleFilters: [] },
  });
  const oldest = run('oldest', 1, tests.map(test => ({ ...test, durationMs: 2 })));
  const previous = run('previous', 2, tests);
  const activeTests = scenario === 'live-narrow-rerun' ? tests.slice(0, Math.max(1, Math.floor(count / 100))) : tests;
  let active = run('active', 3, activeTests.map(test => ({ ...test, status: 'pending', completedRuns: 0 })), 'running');
  return { next(iteration) {
    const updated = [...active.tests];
    const changed = Math.max(1, Math.floor(updated.length / 100));
    for (let offset = 0; offset < changed; offset++) {
      const row = (iteration * changed + offset) % updated.length;
      updated[row] = { ...updated[row], status: iteration % 2 ? 'passed' : 'failed', completedRuns: 1,
        durationMs: iteration + 1, message: iteration % 2 ? undefined : 'benchmark failure' };
    }
    active = { ...active, tests: updated, durationMs: iteration + 1 };
    return { nodes: scenario === 'inventory-replaced' ? tree(iteration) : nodes,
      runs: scenario === 'empty-history' ? [] : [active, previous, oldest] };
  } };
}
