#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const { CompanionLiveRunTracker } = require('../out/core/companionLive.js');
const { lookupTestRunStatus, withParsedReport } = require('../out/core/companionReport.js');

const event = { version: 1, runId: 'benchmark' };
const summaryFor = total => ({
  id: 'benchmark', kind: 'companion-run', targetId: 'target', cwd: '/workspace', status: 'running',
  startedAt: 1, durationMs: 0, total, passed: 0, failed: 0, skipped: 0, flaky: 0,
  failures: [], args: [], selection: { files: [], titleFilters: [] }, projects: [],
});

const results = [];
for (const count of [250, 1000, 2000]) {
  const tests = Array.from({ length: count }, (_, index) => ({
    id: String(index), title: `suite › test ${index}`, titlePath: ['suite', `test ${index}`],
    file: '/workspace/example.spec.ts', line: index + 1, column: 1,
  }));
  const samples = [];
  for (let iteration = 0; iteration < 10; iteration++) {
    const tracker = new CompanionLiveRunTracker('/workspace');
    const start = performance.now();
    const planned = tracker.apply(summaryFor(count), [{ ...event, type: 'plan', total: count, tests }], 0);
    const planMs = performance.now() - start;
    const lookupStart = performance.now();
    for (const test of tests) {
      lookupTestRunStatus(planned, true, test.file, test.line - 1, test.titlePath, test.column);
    }
    const lookupMs = performance.now() - lookupStart;
    const parsed = {
      total: count, passed: count, failed: 0, skipped: 0, flaky: 0, durationMs: 1,
      failures: [], tests: tests.map(test => ({ ...test, status: 'passed' })),
    };
    const mergeStart = performance.now();
    const final = withParsedReport(planned, parsed);
    const mergeMs = performance.now() - mergeStart;
    assert.equal(final.tests.length, count);
    assert.equal(final.passed, count);
    if (iteration >= 3) samples.push({ planMs, lookupMs, mergeMs });
  }
  const median = key => samples.map(sample => sample[key]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  results.push({ tests: count, planMs: median('planMs'), lookupMs: median('lookupMs'), mergeMs: median('mergeMs') });
}
console.log('Median milliseconds after 3 warmups and 7 measured runs; lookup includes building the snapshot index.');
console.table(results.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key === 'tests' ? value : +value.toFixed(2)]))));
console.log('1,000 → 2,000 test growth:', Object.fromEntries(['planMs', 'lookupMs', 'mergeMs'].map(key => [key, +(results[2][key] / results[1][key]).toFixed(2)])));
