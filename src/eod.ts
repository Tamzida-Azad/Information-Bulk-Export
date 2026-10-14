import { config } from './config';
import { dateKey, isWeekday, localDateParts } from './calendar';
import { closeSlackSession, loginToSlack } from './login';
import { log, logBlock } from './logger';
import { buildEodMessage, parseTaskUpdates, type TaskUpdate } from './parser';
import { clearLocalPostedFlag, hasLocalPostedFlag, markLocalPosted } from './posted-state';
import { deleteTodaysEod, getMyMessagesToday, hasTodaysEod, postToChannel } from './slack';

export { buildEodMessage };

export type EodResult = {
  status: 'posted' | 'skipped_empty' | 'skipped_duplicate' | 'dry_run' | 'error';
  message?: string;
  sourceACount: number;
  sourceBCount: number;
  attempts?: number;
};

function wantsForceReplace(): boolean {
  return process.argv.includes('--force') || process.argv.includes('--replace');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(result: EodResult): boolean {
  return result.status === 'error';
}

/**
 * Single scrape + post attempt. Browser session is always closed afterward.
 */
async function attemptGenerateEOD(options?: { force?: boolean }): Promise<EodResult> {
  const today = localDateParts();
  const force = options?.force ?? wantsForceReplace();
  const sourceA = config.slack.channels.sourceA.name;
  const sourceB = config.slack.channels.sourceB.name;
  const eodChannel = config.slack.channels.eod.name;

  log(`EOD attempt started (${dateKey(today)} ${config.timezone}, weekday=${isWeekday(today)})`);
  log(`dryRun=${config.dryRun} headed=${config.headed} force=${force}`);

  if (force) {
    clearLocalPostedFlag();
  }

  if (hasLocalPostedFlag() && !config.dryRun && !force) {
    log('Skip posting — local posted flag already set for today (single-post guard).');
    return { status: 'skipped_duplicate', sourceACount: 0, sourceBCount: 0 };
  }

  let session = null as Awaited<ReturnType<typeof loginToSlack>> | null;

  try {
    session = await loginToSlack();
    const { page } = session;

    log(`Scanning #${sourceA}`);
    const primaryMessages = await getMyMessagesToday(page, 'sourceA');
    const primaryUpdates: TaskUpdate[] = parseTaskUpdates(primaryMessages);
    log(`Source A parsed updates: ${primaryUpdates.length}`);

    let secondaryUpdates: TaskUpdate[] = [];
    log(`Scanning #${sourceB}`);
    try {
      const secondaryMessages = await getMyMessagesToday(page, 'sourceB');
      secondaryUpdates = parseTaskUpdates(secondaryMessages);
      log(`Source B parsed updates: ${secondaryUpdates.length}`);
    } catch (secondaryErr) {
      const msg = secondaryErr instanceof Error ? secondaryErr.message : String(secondaryErr);
      log(`Source B channel skipped (non-fatal): ${msg}`);
    }

    const allUpdates = [...primaryUpdates, ...secondaryUpdates];

    if (!allUpdates.length) {
      log('No task updates found today.');
      return { status: 'skipped_empty', sourceACount: 0, sourceBCount: 0 };
    }

    const eodMessage = buildEodMessage(allUpdates);
    logBlock('EOD content', eodMessage);

    if (force && !config.dryRun) {
      const removed = await deleteTodaysEod(page);
      log(`Force replace: cleared ${removed} existing EOD message(s)`);
    }

    const alreadyPosted = await hasTodaysEod(page);
    if (alreadyPosted && !force) {
      markLocalPosted(eodMessage);
      log(`Skip posting — today's EOD already exists in #${eodChannel}.`);
      return {
        status: 'skipped_duplicate',
        message: eodMessage,
        sourceACount: primaryUpdates.length,
        sourceBCount: secondaryUpdates.length,
      };
    }

    if (config.dryRun) {
      log('DRY RUN complete — not posting.');
      return {
        status: 'dry_run',
        message: eodMessage,
        sourceACount: primaryUpdates.length,
        sourceBCount: secondaryUpdates.length,
      };
    }

    if (force && alreadyPosted) {
      log(
        'WARNING: An EOD: message is still visible after delete attempt — posting corrected EOD anyway. Please remove the old one in Slack if it remains.'
      );
    }

    await postToChannel(page, 'eod', eodMessage, { skipDuplicateGuard: force });

    // Confirm the EOD is actually in the destination channel before treating as success
    const confirmed = await hasTodaysEod(page);
    if (!confirmed) {
      throw new Error(
        `Post appeared to send but EOD: not found yet in #${eodChannel} — will retry`
      );
    }

    markLocalPosted(eodMessage);
    log(`Post status: posted and verified in #${eodChannel}`);
    return {
      status: 'posted',
      message: eodMessage,
      sourceACount: primaryUpdates.length,
      sourceBCount: secondaryUpdates.length,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.stack || error.message : String(error);
    log(`ERROR: ${msg}`);
    return { status: 'error', sourceACount: 0, sourceBCount: 0 };
  } finally {
    if (session) await closeSlackSession(session);
    log('EOD attempt finished (browser closed)');
  }
}

/**
 * Generate and post EOD with automatic retries.
 * Default: up to 10 attempts, waiting 10 minutes between failures,
 * until the EOD is posted (or a non-retryable skip: empty / duplicate / dry-run).
 */
export async function generateEOD(): Promise<EodResult> {
  const max = config.maxRetries; // 0 = unlimited; default 10
  const unlimited = max === 0;
  let attempt = 0;
  let last: EodResult = { status: 'error', sourceACount: 0, sourceBCount: 0 };
  const waitMinutes = Math.round(config.retryDelayMs / 60_000);

  log(
    `EOD retry policy: ${unlimited ? 'until success' : `max ${max} attempt(s)`}, ` +
      `${waitMinutes} min between failures → #${config.slack.channels.eod.name}`
  );

  while (unlimited || attempt < max) {
    attempt += 1;
    log(`——— EOD attempt ${attempt}${unlimited ? '' : ` / ${max}`} ———`);

    last = await attemptGenerateEOD();
    last.attempts = attempt;

    if (!isRetryable(last)) {
      log(`EOD finished with status=${last.status} after ${attempt} attempt(s)`);
      return last;
    }

    if (hasLocalPostedFlag() && !wantsForceReplace()) {
      log('Local posted flag appeared during retries — treating as success/skip.');
      return { status: 'skipped_duplicate', sourceACount: 0, sourceBCount: 0, attempts: attempt };
    }

    if (!unlimited && attempt >= max) break;

    log(
      `EOD post failed (attempt ${attempt}/${unlimited ? '∞' : max}). ` +
        `Waiting ${waitMinutes} min, then retrying until posted to #${config.slack.channels.eod.name}…`
    );
    await sleep(config.retryDelayMs);
  }

  log(`EOD exhausted ${attempt} attempt(s) without posting.`);
  return { ...last, attempts: attempt };
}

async function main(): Promise<void> {
  const result = await generateEOD();
  if (result.status === 'error') process.exitCode = 1;
}

const isDirectRun = /(?:^|[\\/])eod\.(?:ts|js|mts|cjs)$/i.test(process.argv[1] || '');
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
