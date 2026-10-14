import cron from 'node-cron';
import { config } from './config';
import { generateEOD } from './eod';
import { log } from './logger';

const expression = '30 20 * * 1-5';

log(`Scheduler starting — cron "${expression}" timezone ${config.timezone}`);

cron.schedule(
  expression,
  async () => {
    log('Cron fired — generateEOD()');
    try {
      const result = await generateEOD();
      log(`Cron result: ${result.status} (attempts=${result.attempts ?? 1})`);
    } catch (error) {
      log(`Cron error: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  {
    timezone: config.timezone,
  }
);

log(`Scheduler idle — waiting for next weekday 8:30 PM (${config.timezone}) run`);
