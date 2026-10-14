import type { Page } from 'playwright';
import { config } from './config';
import { log } from './logger';

export function looksLikeLoginWall(body: string): boolean {
  const sample = body.slice(0, 1200);
  return /sign in to your workspace|enter your email|magic code|sign in with a password|forgot password/i.test(
    sample
  );
}

export function looksLikeAuthenticatedSlack(body: string): boolean {
  return (
    /message|channels|direct messages|jump to|composer|home/i.test(body.slice(0, 2000)) &&
    !looksLikeLoginWall(body)
  );
}

/**
 * Sign into Slack using SLACK_EMAIL / SLACK_PASSWORD.
 * Uses this project's dedicated browser profile only.
 */
export async function signInWithCredentials(page: Page): Promise<void> {
  if (!config.hasCredentials) {
    throw new Error(
      'Missing SLACK_EMAIL / SLACK_PASSWORD in .env — add them, then run: npm run save-auth'
    );
  }

  log(`Signing into Slack as ${config.slack.email} (dedicated EOD profile)`);

  await page.goto(config.slack.signInUrl, {
    waitUntil: 'domcontentloaded',
    timeout: config.timeouts.navigation,
  });
  await page.waitForTimeout(1500);

  // Some tenants redirect to google/SSO — detect and fail clearly
  const url = page.url();
  if (/accounts\.google\.com|okta\.com|microsoftonline\.com/i.test(url)) {
    throw new Error(
      `Slack redirected to SSO (${url}). Password login is unavailable for this workspace. ` +
        'Run headed `npm run save-auth` and complete SSO once in the dedicated profile.'
    );
  }

  const email = page
    .locator(
      'input[data-qa="login_email"], input#email, input[name="email"], input[type="email"]'
    )
    .first();
  const password = page
    .locator(
      'input[data-qa="login_password"], input#password, input[name="password"], input[type="password"]'
    )
    .first();

  await email.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  await email.fill('');
  await email.fill(config.slack.email);

  // Some Slack flows show email first, then password on next step
  const continueBtn = page
    .locator(
      'button[data-qa="submit_email_button"], button:has-text("Continue"), button:has-text("Sign In With Email")'
    )
    .first();
  if ((await password.count()) === 0 && (await continueBtn.count()) > 0) {
    await continueBtn.click();
    await page.waitForTimeout(1200);
  }

  await password.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  await password.fill('');
  await password.fill(config.slack.password);

  const signIn = page
    .locator(
      'button[data-qa="signin_button"], button[type="submit"], button:has-text("Sign In"), button:has-text("Sign in")'
    )
    .first();
  await signIn.click();
  await page.waitForTimeout(4000);

  const body = await page.locator('body').innerText().catch(() => '');
  if (/magic code|enter the code|two-factor|authentication code|verify your identity/i.test(body)) {
    throw new Error(
      'Slack requires MFA / magic code. Complete it once with headed `npm run save-auth`, ' +
        'then the dedicated local profile will stay signed in.'
    );
  }

  // Land on workspace
  await page.goto(config.slack.workspaceUrl, {
    waitUntil: 'domcontentloaded',
    timeout: config.timeouts.navigation,
  });
  await page.waitForTimeout(3000);

  const after = await page.locator('body').innerText().catch(() => '');
  if (looksLikeLoginWall(after) && !looksLikeAuthenticatedSlack(after)) {
    throw new Error(
      'Slack credential login did not establish a session. Check SLACK_EMAIL / SLACK_PASSWORD, ' +
        'or run headed `npm run save-auth` to finish sign-in manually on the dedicated profile.'
    );
  }

  log('Credential sign-in succeeded');
}
