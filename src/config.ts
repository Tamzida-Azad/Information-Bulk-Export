import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const rootDir = path.resolve(__dirname, '..');

/** Logical channel roles — real Slack names come from env only. */
export type ChannelKey = 'sourceA' | 'sourceB' | 'eod';

function requiredEnvHint(name: string, fallback: string): string {
  return (process.env[name] || '').trim() || fallback;
}

/**
 * Dedicated local Chromium profile for this tool only.
 * Never commit browser-profile/ or .env — those hold your Slack session.
 */
export const config = {
  rootDir,
  timezone: requiredEnvHint('EOD_TIMEZONE', 'UTC'),
  /** Hostname used to recognize project-management task links (no scheme). */
  taskUrlHost: requiredEnvHint('TASK_URL_HOST', 'pm.example.com'),
  slack: {
    workspaceUrl: requiredEnvHint('SLACK_WORKSPACE_URL', 'https://your-workspace.slack.com/'),
    signInUrl: requiredEnvHint(
      'SLACK_SIGN_IN_URL',
      'https://your-workspace.slack.com/sign_in_with_password'
    ),
    teamId: requiredEnvHint('SLACK_TEAM_ID', 'T0000000000'),
    displayName: requiredEnvHint('SLACK_DISPLAY_NAME', 'Your Display Name'),
    memberId: requiredEnvHint('SLACK_MEMBER_ID', 'U0000000000'),
    email: (process.env.SLACK_EMAIL || '').trim(),
    password: process.env.SLACK_PASSWORD || '',
    channels: {
      sourceA: {
        name: requiredEnvHint('SLACK_SOURCE_A_NAME', 'project-updates'),
        id: (process.env.SLACK_SOURCE_A_ID || '').trim(),
      },
      sourceB: {
        name: requiredEnvHint('SLACK_SOURCE_B_NAME', 'team-internal'),
        id: (process.env.SLACK_SOURCE_B_ID || '').trim(),
      },
      eod: {
        name: requiredEnvHint('SLACK_EOD_CHANNEL_NAME', 'eod-updates'),
        id: (process.env.SLACK_EOD_CHANNEL_ID || '').trim(),
      },
    } as Record<ChannelKey, { name: string; id: string }>,
  },
  paths: {
    browserProfile: path.join(rootDir, 'browser-profile'),
    logsDir: path.join(rootDir, 'logs'),
  },
  timeouts: {
    navigation: 60_000,
    action: 20_000,
  },
  get headed() {
    return process.env.EOD_HEADED === '1' || process.argv.includes('--headed');
  },
  get dryRun() {
    return process.env.EOD_DRY_RUN === '1' || process.argv.includes('--dry');
  },
  get hasCredentials() {
    return Boolean(config.slack.email && config.slack.password);
  },
  /**
   * Max post attempts (default 10). Set 0 only if you want unlimited retries.
   */
  get maxRetries() {
    const raw = (process.env.EOD_MAX_RETRIES || '10').trim();
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 10;
  },
  /** Fixed wait between failed attempts (default 10 minutes). */
  get retryDelayMs() {
    const n = Number(process.env.EOD_RETRY_DELAY_MS || String(10 * 60 * 1000));
    return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 10 * 60 * 1000;
  },
};

export function channelClientUrl(channelId: string): string {
  return `https://app.slack.com/client/${config.slack.teamId}/${channelId}`;
}

/** Escape a hostname for use inside a RegExp source string. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
