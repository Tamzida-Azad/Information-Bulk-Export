import fs from 'fs';
import path from 'path';
import { config } from './config';
import { dateKey, localDateParts } from './calendar';

function logFilePath(date = new Date()): string {
  const key = dateKey(localDateParts(date));
  return path.join(config.paths.logsDir, `eod-${key}.log`);
}

function stamp(): string {
  return new Date().toISOString();
}

export function ensureLogsDir(): void {
  fs.mkdirSync(config.paths.logsDir, { recursive: true });
}

export function log(message: string): void {
  ensureLogsDir();
  const line = `[${stamp()}] ${message}`;
  console.log(line);
  fs.appendFileSync(logFilePath(), `${line}\n`, 'utf8');
}

export function logBlock(title: string, body: string): void {
  log(`--- ${title} ---`);
  for (const line of body.split(/\r?\n/)) {
    log(line);
  }
  log(`--- end ${title} ---`);
}
