import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { config } from './config';
import {
  looksLikeAuthenticatedSlack,
  looksLikeLoginWall,
  signInWithCredentials,
} from './slack-auth';

async function waitUntilSignedIn(page: import('playwright').Page, timeoutMs = 5 * 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const body = await page.locator('body').innerText().catch(() => '');
    const url = page.url();
    const hasComposer = (await page.locator('[data-qa="message_input"]').count().catch(() => 0)) > 0;
    const hasChannel = (await page.locator('[data-qa="channel_name"]').count().catch(() => 0)) > 0;

    if (
      hasComposer ||
      hasChannel ||
      (looksLikeAuthenticatedSlack(body) && !looksLikeLoginWall(body)) ||
      (/app\.slack\.com\/client\//i.test(url) && !looksLikeLoginWall(body))
    ) {
      return;
    }

    await page.waitForTimeout(2000);
  }
  throw new Error('Timed out waiting for Slack sign-in (5 minutes).');
}

async function main(): Promise<void> {
  fs.mkdirSync(config.paths.logsDir, { recursive: true });
  fs.mkdirSync(config.paths.browserProfile, { recursive: true });

  for (const name of ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const p = path.join(config.paths.browserProfile, name);
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    } catch {
      // ignore
    }
  }

  console.log('========================================');
  console.log(' EOD Generator — dedicated Slack login');
  console.log('========================================');
  console.log('');
  console.log('A Chromium window will open (THIS project profile only).');
  console.log(`Profile: ${config.paths.browserProfile}`);
  console.log('');
  console.log('Please sign in to your Slack workspace in that window.');
  console.log(`Then open #${config.slack.channels.sourceA.name} once if you can.`);
  console.log('I will detect when you are signed in (up to 5 minutes).');
  console.log('Other automations are NOT using this browser.');
  console.log('');

  const context = await chromium.launchPersistentContext(config.paths.browserProfile, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || (await context.newPage());

  try {
    if (config.hasCredentials) {
      console.log('Credentials found in .env — trying automatic password login first...');
      try {
        await signInWithCredentials(page);
      } catch (error) {
        console.log('Auto-login did not finish (SSO/MFA?). Continue signing in manually in the browser.');
        console.log(String(error instanceof Error ? error.message : error));
        await page.goto(config.slack.workspaceUrl, {
          waitUntil: 'domcontentloaded',
          timeout: config.timeouts.navigation,
        });
      }
    } else {
      await page.goto(config.slack.workspaceUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.timeouts.navigation,
      });
    }

    console.log('Waiting for you to finish Slack sign-in...');
    await waitUntilSignedIn(page);

    // Warm channels so Slack remembers them
    for (const key of ['sourceA', 'eod'] as const) {
      const id = config.slack.channels[key].id;
      if (!id) continue;
      const url = `https://app.slack.com/client/${config.slack.teamId}/${id}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeouts.navigation }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    console.log('');
    console.log('Signed in — saving dedicated session and closing browser.');
  } finally {
    await context.close();
  }

  console.log(`Saved: ${config.paths.browserProfile}`);
  console.log('Next: npm run generate-eod:dry');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
