import * as path from 'path';

export interface SourceTestIdentity {
  title: string;
  titlePath?: string[];
  file?: string;
  line?: number;
  column?: number;
}

/** Compatibility normalization for summaries written before structured titles. */
export function legacyTitle(title: string): string {
  const parts = title.split(' › ');
  if (parts.length > 1 && /(?:\.[cm]?[jt]sx?$|[/\\])/.test(parts[0])) {
    parts.shift();
  }
  return parts.join(' › ').replace(/(?:\s*\(retry\s*#\d+\))$/gi, '')
    .replace(/(?:\s+@\S+)+$/g, '').trim();
}

/** Indexes source tests independently of project, repetition, and attempt IDs. */
export class SourceTestIndex<T> {
  private readonly exact = new Map<string, T[]>();
  private readonly legacy = new Map<string, T[]>();
  private readonly locations = new Map<string, T[]>();

  constructor(private readonly identity: (value: T) => SourceTestIdentity, private readonly cwd: string) {}

  add(value: T): void {
    const item = this.identity(value);
    this.append(this.exact, this.key(item, true), value);
    this.append(this.legacy, this.key(item, false), value);
    this.append(this.locations, this.locationKey(item), value);
  }

  find(item: SourceTestIdentity): T | undefined {
    const exact = this.exact.get(this.key(item, true)) ?? [];
    if (exact.length === 1) {
      return exact[0];
    }
    const candidates = (this.legacy.get(this.key(item, false)) ?? []).filter((value) => {
      const candidate = this.identity(value);
      return (item.column === undefined || candidate.column === undefined || item.column === candidate.column)
        && (!item.titlePath || !candidate.titlePath || JSON.stringify(item.titlePath) === JSON.stringify(candidate.titlePath));
    });
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  atLocation(item: SourceTestIdentity): readonly T[] {
    const values = this.locations.get(this.locationKey(item)) ?? [];
    return item.column === undefined ? values : values.filter((value) => {
      const column = this.identity(value).column;
      return column === undefined || column === item.column;
    });
  }

  private locationKey(item: SourceTestIdentity): string {
    return JSON.stringify([item.file ? path.resolve(this.cwd, item.file) : '', item.line]);
  }

  private key(item: SourceTestIdentity, structured: boolean): string {
    return JSON.stringify([this.locationKey(item), structured ? item.column : undefined,
      structured && item.titlePath ? item.titlePath : legacyTitle(item.title)]);
  }

  private append(map: Map<string, T[]>, key: string, value: T): void {
    const values = map.get(key);
    if (values) {
      values.push(value);
    } else {
      map.set(key, [value]);
    }
  }
}
