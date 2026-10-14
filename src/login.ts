import fs from 'fs';
import path from 'path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { config } from './config';
import { log } from './logger';
import {
  looksLikeAuthenticatedSlack,
  looksLikeLoginWall,
  signInWithCredentials,
} from './slack-auth';

export type SlackSession = {
  context: BrowserContext;
  page: Page;
};

function ensureProfileDir(): void {
  fs.mkdirSync(config.paths.browserProfile, { recursive: true });
  for (const name of ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const p = path.join(config.paths.browserProfile, name);
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    } catch {
      // ignore
    }
  }
}

export async function loginToSlack(): Promise<SlackSession> {
  ensureProfileDir();

  log(
    `Launching dedicated Slack session (profile=${config.paths.browserProfile}, headed=${config.headed})`
  );

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(config.paths.browserProfile, {
      headless: !config.headed,
      viewport: { width: 1400, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/existing browser session|profile is already in use|SingletonLock/i.test(msg)) {
      throw new Error(
        `Dedicated EOD browser-profile is locked.\n` +
          `Close leftover Chromium for this project only, then retry.\n` +
          `Profile: ${config.paths.browserProfile}\n` +
          `Original: ${msg}`
      );
    }
    throw error;
  }

  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});

  const page = context.pages()[0] || (await context.newPage());

  await page.goto(config.slack.workspaceUrl, {
    waitUntil: 'domcontentloaded',
    timeout: config.timeouts.navigation,
  });
  await page.waitForTimeout(2500);

  const body = await page.locator('body').innerText().catch(() => '');
  const needsLogin = looksLikeLoginWall(body) && !looksLikeAuthenticatedSlack(body);

  if (needsLogin) {
    if (config.hasCredentials) {
      try {
        await signInWithCredentials(page);
      } catch (error) {
        await context.close().catch(() => {});
        throw error;
      }
    } else {
      await context.close().catch(() => {});
      throw new Error(
        'Slack login required on dedicated EOD profile.\n' +
          'Add SLACK_EMAIL and SLACK_PASSWORD to .env, then run: npm run save-auth\n' +
          'Or run headed save-auth and sign in manually (does not touch other automations).'
      );
    }
  }

  log('Slack session ready (dedicated EOD profile — other automations untouched)');
  return { context, page };
}

export async function closeSlackSession(session: SlackSession): Promise<void> {
  await session.context.close().catch(() => {});
}
