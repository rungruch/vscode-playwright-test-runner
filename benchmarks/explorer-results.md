# Test Explorer result projection benchmark

This benchmark measures the synchronous work that maps companion run snapshots onto Test Explorer test, suite, file, and folder decorations. It excludes Playwright CLI execution, filesystem discovery, fixture construction, and VS Code rendering; the timings are not end-to-end test-run times.

## Reproduce

```sh
npm ci
npm run benchmark:explorer -- --output benchmarks/explorer-results.json
```

For a quicker local check:

```sh
npm run benchmark:explorer -- --sizes 1000,10000 --warmup 3 --samples 7
```

The baseline is a standalone bundle captured from the uncommitted implementation before optimization on 2026-10-03, including its original source-identity index. It lives in [baselines/explorer-results-before.cjs](baselines/explorer-results-before.cjs); it is benchmark input and is excluded from the extension package. The current implementation is compiled from the working tree. The JSON report records SHA-256 hashes of both implementations, shared fixture code, and the benchmark script.

## Method

- Eight warmup snapshots followed by 31 measured snapshots per implementation and scenario.
- Both implementations receive identical inputs in the same process. Their execution order alternates on each snapshot.
- Both implementations use standalone CommonJS/ES2022 bundles built with esbuild; the candidate is rebuilt from source when the benchmark starts.
- The complete result maps are compared using `assert.deepStrictEqual` after every pair of calls, outside the timed regions.
- Fixtures have three retained runs, 100 tests per file, nested folders/suites, four generated cases per declaration, and legacy rows with missing title paths or columns.
- Each live snapshot has a new summary and test array, with 1% of active rows replaced by changed status, duration, and error-message values. Other rows retain their identities, as in `CompanionLiveRunTracker`.
- `cold-full` uses a fresh projector each time. `live-full` changes a full run. `live-narrow-rerun` changes a rerun containing 1% of the inventory while retaining older results for the remaining tests. `inventory-replaced` rebuilds all inventory nodes each time. `empty-history` has no retained runs.
- Timings include natural garbage collection. Medians and nearest-rank p95 values summarize the raw samples. Compare repeated runs on the same machine; CPU load, runtime, and path lengths affect absolute timings.

## Implementation

The live explorer keeps one result projector. It indexes only runs needed to resolve the inventory, caches source matches while test identities and ordering remain stable, and reads status/duration/message from each fresh snapshot. Source changes, reordered or resized plans, and changed working directories rebuild the relevant index. Replacement inventory nodes are matched anew. Cache entries are bounded by retained run IDs; inventory-node matches use weak references.

Folder, file, and suite totals are accumulated in one pass. File-scoped discovery reports no longer trigger an unrelated full inventory refresh. The benchmark measures result projection; it does not include savings from suppressing those refresh notifications.

Unit coverage checks status updates, cancellation, history clearing, reordered/expanded/reduced plans, changed source fields and working directories, replacement inventory nodes, legacy ambiguity, and fallback to older runs. Extension coverage checks that file-scoped reports avoid refresh notifications while invalidation still immediately disables stale actions.

## Recorded results

See [explorer-results.json](explorer-results.json) for the captured environment, implementation hashes, and every raw sample.
