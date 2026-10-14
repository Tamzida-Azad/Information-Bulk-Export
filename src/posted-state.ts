import fs from 'fs';
import path from 'path';
import { config } from './config';
import { dateKey, localDateParts } from './calendar';
import { ensureLogsDir, log } from './logger';

function postedFlagPath(date = new Date()): string {
  return path.join(config.paths.logsDir, `eod-posted-${dateKey(localDateParts(date))}.flag`);
}

export function hasLocalPostedFlag(): boolean {
  return fs.existsSync(postedFlagPath());
}

export function markLocalPosted(messagePreview: string): void {
  ensureLogsDir();
  const payload = {
    postedAt: new Date().toISOString(),
    preview: messagePreview.slice(0, 200),
  };
  fs.writeFileSync(postedFlagPath(), JSON.stringify(payload, null, 2), 'utf8');
  log(`Local posted flag written: ${postedFlagPath()}`);
}

export function clearLocalPostedFlag(): void {
  const p = postedFlagPath();
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    log(`Local posted flag cleared: ${p}`);
  }
}
