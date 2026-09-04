import * as path from 'path';
import { parse } from '@babel/parser';
import {
  DiscoveredConfig,
  DiscoveredFile,
  DiscoveredSuite,
  DiscoveredTest,
} from './model';

interface CalleeInfo {
  kind: 'test' | 'suite';
  skipped: boolean;
}

/**
 * Fast in-memory AST parser for Playwright test files using `@babel/parser`.
 * Extracts test and suite locations in 1-3ms without spawning child processes.
 */
export function parseTestFileAst(
  code: string,
  filePath: string,
  options?: { targetId?: string; rootDir?: string },
): DiscoveredConfig {
  const normalizedFile = path.normalize(filePath);
  const targetId = options?.targetId ?? 'ast';
  const rootDir = options?.rootDir ?? path.dirname(normalizedFile);
  const relativeFile = path.relative(rootDir, normalizedFile) || path.basename(normalizedFile);

  const fileEntry: DiscoveredFile = {
    id: `${targetId}:file:${relativeFile}`,
    file: normalizedFile,
    relativeFile,
    suites: [],
    tests: [],
  };

  const config: DiscoveredConfig = {
    id: targetId,
    cwd: rootDir,
    rootDir,
    projects: [],
    files: [fileEntry],
    errors: [],
  };

  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      plugins: [
        'typescript',
        'jsx',
        'decorators',
      ],
      errorRecovery: true,
    });
  } catch (err) {
    config.errors.push(err instanceof Error ? err.message : String(err));
    scanFallback(code, fileEntry, targetId, normalizedFile);
    return config;
  }

  // Active stack of suites: top is currently enclosing suite (null means root)
  const suiteStack: DiscoveredSuite[] = [];

  // Recursive AST walker
  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (isCallExpression(node)) {
      const calleeInfo = resolveCallee(node.callee);
      if (calleeInfo) {
        const title = extractTitle(node.arguments[0]);
        const tags = extractTags(node.arguments);
        const line = node.loc?.start.line ?? 1;
        const column = (node.loc?.start.column ?? 0) + 1;

        if (calleeInfo.kind === 'suite') {
          const currentSuite = suiteStack[suiteStack.length - 1];
          const suitePath = currentSuite ? [...suiteTitlePath(suiteStack), title] : [title];
          const suite: DiscoveredSuite = {
            id: `${targetId}:suite:${relativeFile}:${suitePath.join('>')}:${line}`,
            title,
            location: { file: normalizedFile, line, column },
            suites: [],
            tests: [],
          };

          if (currentSuite) {
            currentSuite.suites.push(suite);
          } else {
            fileEntry.suites.push(suite);
          }

          suiteStack.push(suite);

          // Traverse arguments (including the suite callback) with this suite active
          for (const arg of node.arguments) {
            walk(arg);
          }

          suiteStack.pop();
          return;
        } else if (calleeInfo.kind === 'test') {
          const currentSuite = suiteStack[suiteStack.length - 1];
          const titlePath = currentSuite ? [...suiteTitlePath(suiteStack), title] : [title];
          const test: DiscoveredTest = {
            id: `${targetId}:spec:${normalizedFile}:${line}:${titlePath.join('>')}`,
            title,
            fullTitle: titlePath.join(' '),
            location: { file: normalizedFile, line, column },
            projects: [],
            tags,
            skipped: calleeInfo.skipped,
          };

          if (currentSuite) {
            currentSuite.tests.push(test);
          } else {
            fileEntry.tests.push(test);
          }

          // Traverse into test callback (may contain helper calls or dynamic nested tests)
          for (const arg of node.arguments) {
            walk(arg);
          }
          return;
        }
      }
    }

    // Generic traversal for object properties, array items, child statements
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'comments' || key === 'tokens') {
        continue;
      }
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          walk(item);
        }
      } else if (child && typeof child === 'object') {
        walk(child);
      }
    }
  }

  walk(ast);
  return config;
}

function suiteTitlePath(stack: readonly DiscoveredSuite[]): string[] {
  return stack.map((s) => s.title);
}

function isCallExpression(node: unknown): node is {
  type: 'CallExpression';
  callee: unknown;
  arguments: unknown[];
  loc?: { start: { line: number; column: number } };
} {
  return typeof node === 'object' && node !== null && (node as { type?: string }).type === 'CallExpression';
}

function resolveCallee(callee: unknown): CalleeInfo | undefined {
  if (!callee || typeof callee !== 'object') {
    return undefined;
  }

  const parts = flattenCallee(callee);
  if (parts.length === 0) {
    return undefined;
  }

  const root = parts[0];
  if (root !== 'test' && root !== 'it' && root !== 'describe') {
    return undefined;
  }

  // Exclude non-test Playwright APIs
  const second = parts[1];
  if (
    second === 'step' ||
    second === 'beforeEach' ||
    second === 'afterEach' ||
    second === 'beforeAll' ||
    second === 'afterAll' ||
    second === 'use' ||
    second === 'expect' ||
    second === 'info' ||
    second === 'setTimeout' ||
    second === 'slow' && parts.length === 2 && root === 'test'
  ) {
    return undefined;
  }

  // Suites: describe(...), test.describe(...)
  if (root === 'describe' || (root === 'test' && second === 'describe')) {
    if (parts.includes('configure')) {
      return undefined;
    }
    const isSkipped = parts.includes('skip') || parts.includes('fixme');
    return { kind: 'suite', skipped: isSkipped };
  }

  // Tests: test(...), it(...), test.only(...), test.skip(...), etc.
  if (root === 'test' || root === 'it') {
    const isSkipped = parts.includes('skip') || parts.includes('fixme');
    return { kind: 'test', skipped: isSkipped };
  }

  return undefined;
}

function flattenCallee(node: unknown): string[] {
  if (!node || typeof node !== 'object') {
    return [];
  }
  const n = node as { type?: string; name?: string; object?: unknown; property?: { name?: string; value?: string } };
  if (n.type === 'Identifier' && typeof n.name === 'string') {
    return [n.name];
  }
  if (n.type === 'MemberExpression' && n.object && n.property) {
    const parent = flattenCallee(n.object);
    const prop = typeof n.property.name === 'string' ? n.property.name : String(n.property.value ?? '');
    return [...parent, prop];
  }
  return [];
}

function extractTitle(arg: unknown): string {
  if (!arg || typeof arg !== 'object') {
    return '<unnamed>';
  }
  const a = arg as { type?: string; value?: unknown; quasis?: Array<{ value?: { raw?: string } }> };
  if (a.type === 'StringLiteral' && typeof a.value === 'string') {
    return a.value;
  }
  if (a.type === 'TemplateLiteral' && Array.isArray(a.quasis)) {
    return a.quasis.map((q) => q.value?.raw ?? '').join('${...}');
  }
  if (a.type === 'BinaryExpression') {
    const bin = arg as { left: unknown; right: unknown };
    return `${extractTitle(bin.left)} ${extractTitle(bin.right)}`.trim();
  }
  return '<unnamed>';
}

function extractTags(args: unknown[]): string[] {
  const tags = new Set<string>();

  // 1. Tags in title string
  const title = extractTitle(args[0]);
  const matched = title.match(/@[A-Za-z0-9_./:-]+/g);
  if (matched) {
    for (const t of matched) {
      tags.add(t);
    }
  }

  // 2. Options object in args[1], e.g. { tag: '@smoke' } or { tag: ['@smoke', '@fast'] }
  if (args.length > 1 && typeof args[1] === 'object' && args[1] !== null) {
    const opt = args[1] as { type?: string; properties?: unknown[] };
    if (opt.type === 'ObjectExpression' && Array.isArray(opt.properties)) {
      for (const prop of opt.properties) {
        if (typeof prop === 'object' && prop !== null) {
          const p = prop as {
            key?: { name?: string; value?: string };
            value?: { type?: string; value?: string; elements?: unknown[] };
          };
          const key = p.key?.name ?? p.key?.value;
          if (key === 'tag' && p.value) {
            if (p.value.type === 'StringLiteral' && typeof p.value.value === 'string') {
              tags.add(p.value.value);
            } else if (p.value.type === 'ArrayExpression' && Array.isArray(p.value.elements)) {
              for (const el of p.value.elements) {
                if (el && typeof el === 'object' && (el as { type?: string }).type === 'StringLiteral') {
                  const val = (el as { value?: string }).value;
                  if (typeof val === 'string') {
                    tags.add(val);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return [...tags].sort((a, b) => a.localeCompare(b));
}

/**
 * Resilient regex fallback scanner used only when the file contains syntax errors
 * that prevent AST generation (e.g. unclosed string literal while typing).
 */
function scanFallback(
  code: string,
  fileEntry: DiscoveredFile,
  targetId: string,
  normalizedFile: string,
): void {
  const lines = code.split(/\r?\n/);
  const suiteRegex = /(?:test\.describe|describe)(?:\.(?:only|skip|serial|parallel))?\s*\(\s*(['"`])(.*?)\1/g;
  const testRegex = /(?:test|it)(?:\.(?:only|skip|fixme|fail))?\s*\(\s*(['"`])(.*?)\1/g;

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const lineNumber = i + 1;

    let match: RegExpExecArray | null;
    suiteRegex.lastIndex = 0;
    while ((match = suiteRegex.exec(lineText)) !== null) {
      const title = match[2];
      fileEntry.suites.push({
        id: `${targetId}:suite:${fileEntry.relativeFile}:${title}:${lineNumber}`,
        title,
        location: { file: normalizedFile, line: lineNumber, column: match.index + 1 },
        suites: [],
        tests: [],
      });
    }

    testRegex.lastIndex = 0;
    while ((match = testRegex.exec(lineText)) !== null) {
      const title = match[2];
      const tags = (title.match(/@[A-Za-z0-9_./:-]+/g) ?? []).sort((a, b) => a.localeCompare(b));
      const skipped = match[0].includes('.skip') || match[0].includes('.fixme');
      fileEntry.tests.push({
        id: `${targetId}:spec:${normalizedFile}:${lineNumber}:${title}`,
        title,
        fullTitle: title,
        location: { file: normalizedFile, line: lineNumber, column: match.index + 1 },
        projects: [],
        tags,
        skipped,
      });
    }
  }
}
