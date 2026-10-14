import fs from 'fs';
import path from 'path';
import { log } from './logger';

const SKIP_NAMES = new Set([
  'lockfile',
  'singletonlock',
  'singletoncookie',
  'singletonsocket',
  'browsermetrics',
  'deferredbrowsermetrics',
  'crashpad',
  'gpupersistentcache',
  'shadercache',
  'grshadercache',
]);

function shouldSkip(name: string): boolean {
  const lower = name.toLowerCase();
  if (SKIP_NAMES.has(lower)) return true;
  if (lower.endsWith('lock')) return true;
  return false;
}

function clearRuntimeLocks(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const name of [
    'lockfile',
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
  ]) {
    const p = path.join(dir, name);
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    } catch {
      // ignore
    }
  }
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* brief spin — sync copy path only */
  }
}

function copyFileWithRetry(from: string, to: string, retries = 6): void {
  let lastError: unknown;
  for (let i = 0; i < retries; i += 1) {
    try {
      fs.copyFileSync(from, to);
      return;
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      if (!/EBUSY|EPERM|resource busy|locked/i.test(msg) || i === retries - 1) {
        throw error;
      }
      sleepSync(250 * (i + 1));
    }
  }
  throw lastError;
}

function isCriticalAuthFile(name: string): boolean {
  return /^(cookies|cookies-journal|login data|web data)$/i.test(name);
}

/**
 * Best-effort recursive copy. Skips lock files and continues when a source
 * file is busy (e.g. sibling profile currently open by another Playwright).
 * Never launches against the source path — callers always use `dest`.
 */
export function copyProfileBestEffort(source: string, dest: string): {
  copied: number;
  skipped: number;
  errors: string[];
} {
  let copied = 0;
  let skipped = 0;
  const errors: string[] = [];

  if (!fs.existsSync(source)) {
    throw new Error(`Profile source not found: ${source}`);
  }

  fs.mkdirSync(dest, { recursive: true });
  clearRuntimeLocks(dest);

  function walk(srcDir: string, destDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(srcDir, { withFileTypes: true });
    } catch (error) {
      errors.push(`${srcDir}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    fs.mkdirSync(destDir, { recursive: true });

    for (const entry of entries) {
      if (shouldSkip(entry.name)) {
        skipped += 1;
        continue;
      }

      const from = path.join(srcDir, entry.name);
      const to = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        walk(from, to);
        continue;
      }

      if (!entry.isFile() && !entry.isSymbolicLink()) {
        skipped += 1;
        continue;
      }

      try {
        if (isCriticalAuthFile(entry.name)) {
          copyFileWithRetry(from, to);
        } else {
          fs.copyFileSync(from, to);
        }
        copied += 1;
      } catch (error) {
        skipped += 1;
        errors.push(`${from}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  walk(source, dest);
  clearRuntimeLocks(dest);
  return { copied, skipped, errors };
}

export function syncSiblingProfile(options: {
  source: string;
  dest: string;
  logger?: (msg: string) => void;
}): void {
  const write = options.logger || log;
  write(`Syncing Slack profile (read-only copy)`);
  write(`  source: ${options.source}`);
  write(`  dest:   ${options.dest}`);

  const result = copyProfileBestEffort(options.source, options.dest);
  write(`Profile sync done: copied=${result.copied} skipped=${result.skipped}`);

  const cookieDest = path.join(options.dest, 'Default', 'Network', 'Cookies');
  if (!fs.existsSync(cookieDest)) {
    write(
      'WARNING: Cookies file was not copied (sibling profile likely open). ' +
        'Slack session may be stale until Cookies are free — close sibling Chromium briefly, then: npm run sync-profile'
    );
  }

  if (result.errors.length > 0) {
    const preview = result.errors.slice(0, 5).join(' | ');
    write(`Profile sync soft-errors (${result.errors.length}): ${preview}`);
  }

  if (result.copied === 0 && !fs.existsSync(path.join(options.dest, 'Default'))) {
    throw new Error(
      `Could not sync any profile files from ${options.source}. ` +
        'Close other browsers using that profile briefly, or run npm run save-auth.'
    );
  }
}
