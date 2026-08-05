/**
 * Quoting helpers for handing a structured command to an interactive
 * terminal (used only for long-running GUI commands such as `show-report`,
 * `show-trace` and `codegen`). Test execution itself never uses a shell.
 */
export function quoteForTerminal(executable: string, args: string[], platform: NodeJS.Platform = process.platform): string {
  const quote = platform === 'win32' ? quoteCmd : quotePosix;
  return [executable, ...args].map((a) => quote(a)).join(' ');
}

function quotePosix(value: string): string {
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quoteCmd(value: string): string {
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}
