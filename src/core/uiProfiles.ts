import { UiProfile } from './companionTypes';

/** Sanitizes configured profiles into structured argv-safe UI values. */
export function normalizeUiProfiles(value: unknown): UiProfile[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const profiles = new Map<string, UiProfile>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const candidate = raw as { name?: unknown; host?: unknown; port?: unknown };
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    const host = typeof candidate.host === 'string' ? candidate.host.trim() : '';
    const port = typeof candidate.port === 'number' ? candidate.port : Number(candidate.port);
    if (!name || !isValidHost(host) || !Number.isInteger(port) || port < 1 || port > 65_535) {
      continue;
    }
    profiles.set(name, { name, host, port });
  }
  return [...profiles.values()];
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '::1' || normalized === '[::1]'
    || normalized === '127.0.0.1' || normalized.startsWith('127.');
}

function isValidHost(host: string): boolean {
  // Hostnames, IPv4 and bracket-free IPv6 literals are passed directly as one
  // argv token. Whitespace and shell-significant punctuation are rejected.
  return /^[a-zA-Z0-9:.[\]-]+$/.test(host);
}
