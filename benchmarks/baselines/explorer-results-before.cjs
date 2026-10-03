// Benchmark-only snapshot of the uncommitted explorerResults implementation before optimization.
// Captured 2026-10-03; includes SourceTestIndex so later production changes cannot alter the baseline.
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/core/explorerResults.ts
var explorerResults_exports = {};
__export(explorerResults_exports, {
  explorerResults: () => explorerResults,
  resultDescription: () => resultDescription
});
module.exports = __toCommonJS(explorerResults_exports);

// src/core/testIdentity.ts
var path = __toESM(require("path"));
function legacyTitle(title) {
  const parts = title.split(" \u203A ");
  if (parts.length > 1 && /(?:\.[cm]?[jt]sx?$|[/\\])/.test(parts[0])) {
    parts.shift();
  }
  return parts.join(" \u203A ").replace(/(?:\s*\(retry\s*#\d+\))$/gi, "").replace(/(?:\s+@\S+)+$/g, "").trim();
}
var SourceTestIndex = class {
  constructor(identity, cwd) {
    this.identity = identity;
    this.cwd = cwd;
  }
  identity;
  cwd;
  exact = /* @__PURE__ */ new Map();
  legacy = /* @__PURE__ */ new Map();
  locations = /* @__PURE__ */ new Map();
  add(value) {
    const item = this.identity(value);
    this.append(this.exact, this.key(item, true), value);
    this.append(this.legacy, this.key(item, false), value);
    this.append(this.locations, this.locationKey(item), value);
  }
  find(item) {
    const exact = this.exact.get(this.key(item, true)) ?? [];
    if (exact.length === 1) {
      return exact[0];
    }
    const candidates = (this.legacy.get(this.key(item, false)) ?? []).filter((value) => {
      const candidate = this.identity(value);
      return (item.column === void 0 || candidate.column === void 0 || item.column === candidate.column) && (!item.titlePath || !candidate.titlePath || JSON.stringify(item.titlePath) === JSON.stringify(candidate.titlePath));
    });
    return candidates.length === 1 ? candidates[0] : void 0;
  }
  atLocation(item) {
    const values = this.locations.get(this.locationKey(item)) ?? [];
    return item.column === void 0 ? values : values.filter((value) => {
      const column = this.identity(value).column;
      return column === void 0 || column === item.column;
    });
  }
  locationKey(item) {
    return JSON.stringify([item.file ? path.resolve(this.cwd, item.file) : "", item.line]);
  }
  key(item, structured) {
    return JSON.stringify([
      this.locationKey(item),
      structured ? item.column : void 0,
      structured && item.titlePath ? item.titlePath : legacyTitle(item.title)
    ]);
  }
  append(map, key, value) {
    const values = map.get(key);
    if (values) {
      values.push(value);
    } else {
      map.set(key, [value]);
    }
  }
};

// src/core/explorerResults.ts
function explorerResults(nodes, runs) {
  const indexes = [...runs].sort((a, b) => b.startedAt - a.startedAt).map((run) => {
    const index = new SourceTestIndex((test) => test, run.cwd);
    for (const test of run.tests ?? []) {
      index.add(test);
    }
    return { run, index };
  });
  const results = /* @__PURE__ */ new Map();
  const visit = (node) => {
    if (node.kind === "test") {
      const selection = node.selection;
      if (selection) {
        for (const { run, index } of indexes) {
          if (run.targetId !== node.targetId) {
            continue;
          }
          const test = index.find({
            file: selection.file,
            line: selection.position.line + 1,
            column: selection.columnMissing ? void 0 : selection.position.character + 1,
            titlePath: selection.titlePath,
            title: selection.titlePath?.join(" \u203A ") ?? node.label
          });
          if (!test) {
            continue;
          }
          const unfinished = test.status === "pending" || test.status === "running";
          const result2 = {
            status: unfinished && run.status !== "running" ? run.status === "cancelled" ? "cancelled" : "incomplete" : test.status,
            durationMs: test.durationMs ?? 0,
            completed: test.completedRuns ?? (unfinished ? 0 : 1),
            total: test.totalRuns ?? 1,
            active: run.status === "running" ? test.activeRuns ?? (test.status === "running" ? 1 : 0) : 0,
            testCount: 1,
            testedCount: 1,
            message: test.message,
            runId: run.id
          };
          results.set(node.id, result2);
          return { result: result2, count: 1 };
        }
      }
      return { count: 1 };
    }
    const children = node.children.map(visit);
    const count = children.reduce((sum, child) => sum + child.count, 0);
    const found = children.flatMap(({ result: result2 }) => result2 ? [result2] : []);
    if (!found.length) {
      return { count };
    }
    const precedence = ["running", "failed", "flaky", "pending", "cancelled", "incomplete", "passed", "skipped"];
    const result = {
      status: precedence.find((status) => found.some((child) => child.status === status)),
      durationMs: found.reduce((sum, child) => sum + child.durationMs, 0),
      completed: found.reduce((sum, child) => sum + child.completed, 0),
      total: found.reduce((sum, child) => sum + child.total, 0),
      active: found.reduce((sum, child) => sum + child.active, 0),
      testCount: count,
      testedCount: found.reduce((sum, child) => sum + child.testedCount, 0)
    };
    results.set(node.id, result);
    return { result, count };
  };
  nodes.forEach(visit);
  return results;
}
function resultDescription(result) {
  const status = result.status[0].toUpperCase() + result.status.slice(1);
  if (result.status === "running" || result.status === "pending") {
    return `${result.completed}/${result.total} completed \xB7 ${result.active ? `${result.active} running` : status}`;
  }
  const duration = result.durationMs < 1e3 ? `${result.durationMs} ms` : `${(result.durationMs / 1e3).toFixed(1)} s`;
  const coverage = result.testCount > 1 ? ` \xB7 ${result.testedCount}/${result.testCount} tests` : "";
  const repeats = result.total > result.testedCount ? ` \xB7 ${result.completed}/${result.total} runs` : "";
  return `${status}${coverage}${repeats} \xB7 ${duration}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  explorerResults,
  resultDescription
});
