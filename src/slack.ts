import type { Page } from 'playwright';
import {
  addCalendarDays,
  getTodayWindow,
  sameDay,
  type LocalDateParts,
  type TodayWindow,
} from './calendar';
import { channelClientUrl, config, escapeRegExp, type ChannelKey } from './config';
import { log } from './logger';

type ParsedTimestamp = {
  year?: number;
  month?: number;
  day?: number;
  hour?: number | null;
  minute?: number | null;
  raw: string;
  relative?: 'today' | 'yesterday';
  timeOnly?: boolean;
};

type DayContext =
  | 'today'
  | 'yesterday'
  | { kind: 'date'; month: number; day: number; year: number | null }
  | null;

type ScrapedMessage = {
  author: string | null;
  timestamp: string | null;
  body: string;
  dayContext: DayContext;
  dayContextRaw: string | null;
  parsedTimestamp: ParsedTimestamp | null;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function parseSlackTimestamp(text: string | null, realToday: LocalDateParts): ParsedTimestamp | null {
  if (!text) return null;
  const t = String(text).trim().replace(/\.$/, '');

  let m = t.match(/^Today(?:\s+at)?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i);
  if (m) {
    let hour = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) hour += 12;
    return {
      year: realToday.year,
      month: realToday.month,
      day: realToday.day,
      hour,
      minute: Number(m[2]),
      raw: t,
      relative: 'today',
    };
  }

  m = t.match(/^(?:Yesterday)(?:\s+at)?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i);
  if (m) {
    let hour = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) hour += 12;
    const y = addCalendarDays(realToday, -1);
    return {
      year: y.year,
      month: y.month,
      day: y.day,
      hour,
      minute: Number(m[2]),
      raw: t,
      relative: 'yesterday',
    };
  }

  m = t.match(
    /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?.*?(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i
  );
  if (m) {
    let hour = Number(m[4]) % 12;
    if (/pm/i.test(m[6])) hour += 12;
    return {
      year: m[3] ? Number(m[3]) : realToday.year,
      month: MONTHS[m[1].toLowerCase()],
      day: Number(m[2]),
      hour,
      minute: Number(m[5]),
      raw: t,
    };
  }

  m = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i);
  if (m) {
    let hour: number | null = null;
    let minute: number | null = null;
    if (m[4]) {
      hour = Number(m[4]) % 12;
      if (/pm/i.test(m[6])) hour += 12;
      minute = Number(m[5]);
    }
    return {
      year: m[3] ? Number(m[3]) : realToday.year,
      month: Number(m[1]),
      day: Number(m[2]),
      hour,
      minute,
      raw: t,
    };
  }

  m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m) {
    let hour = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) hour += 12;
    return { raw: t, timeOnly: true, hour, minute: Number(m[2]) };
  }

  return { raw: t };
}

function normalizeDayContext(raw: string | null): DayContext {
  const t = String(raw || '').trim();
  if (!t) return null;
  if (/^today$/i.test(t)) return 'today';
  if (/^yesterday$/i.test(t)) return 'yesterday';
  const m = t.match(
    /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i
  );
  if (!m) return null;
  return {
    kind: 'date',
    month: MONTHS[m[1].toLowerCase()],
    day: Number(m[2]),
    year: m[3] ? Number(m[3]) : null,
  };
}

function resolveMessageDate(
  m: ScrapedMessage,
  realToday: LocalDateParts
): { year: number; month: number; day: number; assumedToday?: boolean } | null {
  const ts = m.parsedTimestamp;
  const dayCtx = m.dayContext;

  if (
    ts?.relative === 'today' ||
    (ts?.year != null &&
      ts.month != null &&
      ts.day != null &&
      sameDay({ year: ts.year, month: ts.month, day: ts.day }, realToday) &&
      !ts.timeOnly)
  ) {
    return { year: realToday.year, month: realToday.month, day: realToday.day };
  }

  if (ts?.relative === 'yesterday') {
    const y = addCalendarDays(realToday, -1);
    return { year: y.year, month: y.month, day: y.day };
  }

  if (ts && ts.year && ts.month && ts.day && !ts.timeOnly && ts.relative !== 'today') {
    return { year: ts.year, month: ts.month, day: ts.day };
  }

  let base: { year: number; month: number; day: number } | null = null;
  if (dayCtx === 'today') base = realToday;
  else if (dayCtx === 'yesterday') base = addCalendarDays(realToday, -1);
  else if (dayCtx && typeof dayCtx === 'object' && dayCtx.kind === 'date') {
    base = { year: dayCtx.year || realToday.year, month: dayCtx.month, day: dayCtx.day };
  }

  if (base) return base;

  if (ts?.timeOnly) {
    return {
      year: realToday.year,
      month: realToday.month,
      day: realToday.day,
      assumedToday: true,
    };
  }

  return null;
}

function dayContextMatchesTarget(dayContext: DayContext, window: TodayWindow): boolean | null {
  if (!dayContext) return null;
  const target = window.target;
  const real = window.realToday;
  if (dayContext === 'today') return sameDay(real, target);
  if (dayContext === 'yesterday') return sameDay(addCalendarDays(real, -1), target);
  if (typeof dayContext === 'object' && dayContext.kind === 'date') {
    const year = dayContext.year || real.year;
    return year === target.year && dayContext.month === target.month && dayContext.day === target.day;
  }
  return null;
}

function isTodaysMessage(m: ScrapedMessage, window: TodayWindow): boolean {
  const resolved = resolveMessageDate(m, window.realToday);
  const dayMatch = dayContextMatchesTarget(m.dayContext, window);

  if (!resolved) return dayMatch === true;
  if (!sameDay(resolved, window.target)) return false;
  if (resolved.assumedToday && !sameDay(window.target, window.realToday)) return false;
  return true;
}

function isMyAuthor(author: string | null): boolean {
  if (!author) return false;
  const name = config.slack.displayName.trim().toLowerCase();
  return author.trim().toLowerCase() === name || author.trim().toLowerCase().includes(name);
}

function cleanBody(body: string): string {
  return String(body || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resolveChannelKey(channelName: string): ChannelKey {
  const raw = channelName.replace(/^#/, '').trim();
  const lower = raw.toLowerCase();
  const logicalKeys: Record<string, ChannelKey> = {
    sourcea: 'sourceA',
    sourceb: 'sourceB',
    eod: 'eod',
  };
  if (logicalKeys[lower]) {
    return logicalKeys[lower];
  }
  const byConfigKey = config.slack.channels[raw as ChannelKey];
  if (byConfigKey) {
    return raw as ChannelKey;
  }
  for (const [key, meta] of Object.entries(config.slack.channels) as [ChannelKey, { name: string }][]) {
    if (meta.name.toLowerCase() === lower) {
      return key;
    }
  }
  throw new Error(`Unknown channel: ${channelName}`);
}

export async function openChannel(page: Page, channelName: string): Promise<void> {
  const key = resolveChannelKey(channelName);
  const meta = config.slack.channels[key];
  const slug = meta.name;

  if (meta.id) {
    const url = channelClientUrl(meta.id);
    log(`Opening #${slug} via ${url}`);
    await page.goto(config.slack.workspaceUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.timeouts.navigation,
    });
    await page.waitForTimeout(1500);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: config.timeouts.navigation,
    });
    await page.waitForTimeout(4000);
  } else {
    log(`Opening #${slug} via sidebar (no channel id set)`);
    await page.goto(config.slack.workspaceUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.timeouts.navigation,
    });
    await page.waitForTimeout(3000);

    let sidebar = page.locator(`[data-qa="channel_sidebar_name_${slug}"]`).first();
    if ((await sidebar.count()) === 0) {
      // Channel may be scrolled out of the sidebar — use Slack quick switcher
      log(`Sidebar link for #${slug} not visible — trying Ctrl+K quick switcher`);
      await page.keyboard.press('Control+K');
      await page.waitForTimeout(500);
      const search = page
        .locator(
          '[data-qa="spotlight_input"], input[aria-label*="Search"], [role="dialog"] input'
        )
        .first();
      await search.waitFor({ state: 'visible', timeout: 8000 });
      await search.fill(slug);
      await page.waitForTimeout(800);
      const option = page
        .locator(
          `[data-qa="channel_sidebar_name_${slug}"], ` +
            `[role="option"]:has-text("#${slug}"), ` +
            `[role="listbox"] :has-text("${slug}")`
        )
        .first();
      if ((await option.count()) > 0) {
        await option.click({ timeout: config.timeouts.action });
      } else {
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(4000);
    } else {
      await sidebar.click({ timeout: config.timeouts.action });
      await page.waitForTimeout(4000);
    }
  }

  const header = await page.locator('[data-qa="channel_name"]').innerText().catch(() => '');
  if (!new RegExp(slug, 'i').test(header)) {
    throw new Error(`Expected #${slug} but channel header is "${header}"`);
  }
  log(`Opened #${slug}`);
}

type RawScrapedMessage = {
  author: string | null;
  timestamp: string | null;
  body: string;
  dayContext: string | null;
};

type DayMarkerScan = {
  labels: string[];
  hasToday: boolean;
  hasOlderThanToday: boolean;
  scrollTop: number;
  atTop: boolean;
};

const SCROLL_STEP_PX = 900;
/** Busy channels need many steps; stop early once Today→bottom is fully loaded. */
const MAX_TODAY_SCROLL_STEPS = 60;

async function getMessagePaneScrollState(page: Page): Promise<{ scrollTop: number; atTop: boolean }> {
  const fallback = { scrollTop: 0, atTop: true };
  try {
    const result = (await page.evaluate(`(() => {
      const panes = [...document.querySelectorAll('[data-qa="slack_kit_list"], .c-virtual_list__scroll_container, [class*="message_pane"]')];
      const el = panes.find((p) => p.scrollHeight > 200) || document.scrollingElement;
      if (!el) return { scrollTop: 0, atTop: true };
      return { scrollTop: el.scrollTop || 0, atTop: (el.scrollTop || 0) <= 2 };
    })()`)) as { scrollTop: number; atTop: boolean };
    return result ?? fallback;
  } catch {
    return fallback;
  }
}

async function scrollMessagePane(page: Page, mode: 'bottom' | 'up'): Promise<void> {
  const step = SCROLL_STEP_PX;
  if (mode === 'bottom') {
    await page
      .evaluate(`(() => {
        const panes = [...document.querySelectorAll('[data-qa="slack_kit_list"], .c-virtual_list__scroll_container, [class*="message_pane"]')];
        const el = panes.find((p) => p.scrollHeight > 200) || document.scrollingElement;
        if (el) el.scrollTop = el.scrollHeight;
      })()`)
      .catch(() => {});
    return;
  }
  await page
    .evaluate(`(() => {
      const panes = [...document.querySelectorAll('[data-qa="slack_kit_list"], .c-virtual_list__scroll_container, [class*="message_pane"]')];
      const el = panes.find((p) => p.scrollHeight > 200) || document.scrollingElement;
      if (el) el.scrollTop = Math.max(0, el.scrollTop - ${step});
    })()`)
    .catch(() => {});
}

async function scanDayMarkers(page: Page): Promise<DayMarkerScan> {
  const state = await getMessagePaneScrollState(page);
  const labels = (await page
    .evaluate(`(() => {
      const out = [];
      const nodes = document.querySelectorAll(
        '[data-qa*="day_divider"], [data-qa*="message_separator"], [data-qa="sticky-date"], [class*="day_divider"], .c-message_list__day_divider__label'
      );
      for (const el of nodes) {
        const label =
          (el.querySelector('[data-qa="sticky-date"], .c-message_list__day_divider__label, button') || {}).textContent ||
          el.textContent ||
          '';
        const t = String(label).replace(/\\s+/g, ' ').trim();
        if (t) out.push(t);
      }
      return out;
    })()`)
    .catch(() => [])) as string[];

  const normalized = labels.map((l) => l.replace(/\s+/g, ' ').trim());
  const hasToday = normalized.some((l) => /^today$/i.test(l));
  const hasOlderThanToday = normalized.some(
    (l) =>
      /^yesterday$/i.test(l) ||
      /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}/i.test(
        l
      )
  );

  return {
    labels: normalized,
    hasToday,
    hasOlderThanToday,
    scrollTop: state.scrollTop,
    atTop: state.atTop,
  };
}

function scrapeVisibleMessagesScript(): string {
  // String script so tsx/esbuild does not inject __name into the browser context.
  return `(() => {
    const out = [];
    const seen = new Set();

    const isDayDivider = (el) => {
      const qa = (el.getAttribute('data-qa') || '').toLowerCase();
      if (qa.includes('day_divider') || qa.includes('message_separator') || qa === 'sticky-date') return true;
      const cls = String(el.className || '');
      return /day_divider|message_list__day/i.test(cls);
    };

    const dividerLabel = (el) => {
      const label =
        (el.querySelector('[data-qa="sticky-date"], .c-message_list__day_divider__label, button') || {}).textContent ||
        el.textContent ||
        '';
      return String(label).replace(/\\s+/g, ' ').trim();
    };

    const readTimestamp = (el) => {
      const candidates = [...el.querySelectorAll('a[aria-label], button[aria-label], [data-qa="message_timestamp"], .c-timestamp')];
      for (const node of candidates) {
        const aria = (node.getAttribute('aria-label') || '').trim();
        if (/\\b(AM|PM)\\b/i.test(aria) || /at\\s+\\d{1,2}:\\d{2}/i.test(aria)) return aria;
      }
      return (
        (el.querySelector('[data-qa="timestamp_label"]') || {}).textContent?.trim() ||
        (el.querySelector('.c-timestamp__label') || {}).textContent?.trim() ||
        null
      );
    };

    const readMessageBody = (el) => {
      const textNodes = [...el.querySelectorAll('[data-qa="message-text"]')];
      let body = textNodes
        .map((n) => (n.innerText || n.textContent || '').trim())
        .filter(Boolean)
        .join('\\n')
        .trim();

      if (!body || body.length < 2) {
        const content =
          el.querySelector('[data-qa="message_content"], .c-message_kit__blocks, .p-rich_text_section') ||
          el;
        body = (content.innerText || content.textContent || '').trim();
      }

      const hostRe = ${JSON.stringify(escapeRegExp(config.taskUrlHost))};
      const hrefPattern = new RegExp(
        '(?:' + hostRe + '\\\\/projects\\\\/\\\\d+\\\\/tasks\\\\/\\\\d+)|(?:projects\\\\/\\\\d+\\\\/tasks\\\\/\\\\d+)',
        'i'
      );
      const hrefs = [...el.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href') || '')
        .filter((h) => hrefPattern.test(h));
      for (const href of hrefs) {
        const bare = href.replace(/^https?:\\/\\//i, '').split('?')[0];
        if (bare && !body.includes(bare) && !body.includes(href)) {
          body = body + '\\n' + href;
        }
      }

      return body.trim();
    };

    const listRoot =
      document.querySelector('[data-qa="slack_kit_list"]') ||
      document.querySelector('.c-virtual_list__scroll_container') ||
      document.querySelector('[role="list"]') ||
      document.body;

    let dayContext = null;
    let lastSender = null;
    const walkRoots = listRoot.querySelectorAll(
      '[data-qa="message_container"], [data-qa*="day_divider"], [data-qa*="message_separator"], [data-qa="sticky-date"], [class*="day_divider"]'
    );

    for (const el of walkRoots) {
      if (isDayDivider(el) && el.getAttribute('data-qa') !== 'message_container') {
        const label = dividerLabel(el);
        if (label) dayContext = label;
        lastSender = null;
        continue;
      }
      if (el.getAttribute('data-qa') !== 'message_container') continue;

      const senderRaw =
        (el.querySelector('[data-qa="message_sender_name"]') || {}).textContent?.trim() ||
        (el.querySelector('[data-qa="message_sender"]') || {}).textContent?.trim() ||
        null;
      if (senderRaw) lastSender = senderRaw;
      const sender = senderRaw || lastSender;
      const timestamp = readTimestamp(el);
      const body = readMessageBody(el);
      if (!body || body.length < 2) continue;
      if (/Zoom meeting started|Meeting ID:/i.test(body) && !/EOD/i.test(body)) continue;

      const key = sender + '|' + timestamp + '|' + body.slice(0, 100);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ author: sender, timestamp, body, dayContext });
    }

    if (out.length === 0) {
      const sticky =
        (document.querySelector('[data-qa="sticky-date"]') || {}).textContent?.trim() ||
        (document.querySelector('.c-message_list__day_divider__label') || {}).textContent?.trim() ||
        null;
      lastSender = null;
      for (const el of document.querySelectorAll('[data-qa="message_container"]')) {
        const senderRaw =
          (el.querySelector('[data-qa="message_sender_name"]') || {}).textContent?.trim() ||
          (el.querySelector('[data-qa="message_sender"]') || {}).textContent?.trim() ||
          null;
        if (senderRaw) lastSender = senderRaw;
        const sender = senderRaw || lastSender;
        const timestamp = readTimestamp(el);
        const body = readMessageBody(el);
        if (!body || body.length < 2) continue;
        const key = sender + '|' + timestamp + '|' + body.slice(0, 100);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ author: sender, timestamp, body, dayContext: sticky });
      }
    }

    return out;
  })()`;
}

async function scrapeVisibleRawMessages(page: Page): Promise<RawScrapedMessage[]> {
  return page.evaluate(scrapeVisibleMessagesScript()) as Promise<RawScrapedMessage[]>;
}

async function extractRawMessages(page: Page): Promise<RawScrapedMessage[]> {
  // Slack virtualizes rows — accumulate while scrolling Today → bottom.
  const byKey = new Map<string, RawScrapedMessage>();

  const merge = (batch: RawScrapedMessage[]) => {
    for (const m of batch) {
      const key = `${m.author || ''}|${m.timestamp || ''}|${(m.body || '').slice(0, 120)}`;
      if (!byKey.has(key)) byKey.set(key, m);
    }
  };

  await scrollMessagePane(page, 'bottom');
  await page.waitForTimeout(800);
  merge(await scrapeVisibleRawMessages(page));

  let sawToday = false;
  let prevScrollTop = Number.POSITIVE_INFINITY;

  for (let steps = 0; steps < MAX_TODAY_SCROLL_STEPS; steps += 1) {
    const markers = await scanDayMarkers(page);
    if (markers.hasToday) sawToday = true;

    if (sawToday && markers.hasOlderThanToday) {
      merge(await scrapeVisibleRawMessages(page));
      log(`Scraped Today→bottom range after ${steps} scroll-up step(s)`);
      break;
    }
    if (markers.atTop || markers.scrollTop >= prevScrollTop - 1) {
      merge(await scrapeVisibleRawMessages(page));
      log(
        `Scraped message range after ${steps} scroll-up step(s)` +
          (sawToday ? ' (Today divider seen)' : ' (Today divider not seen)')
      );
      break;
    }
    prevScrollTop = markers.scrollTop;

    await scrollMessagePane(page, 'up');
    await page.waitForTimeout(450);
    merge(await scrapeVisibleRawMessages(page));
  }

  // Final bottom pass so late-day messages are not dropped after scrolling up.
  await scrollMessagePane(page, 'bottom');
  await page.waitForTimeout(600);
  merge(await scrapeVisibleRawMessages(page));

  log(`Raw messages accumulated from Today→bottom pass: ${byKey.size}`);
  return [...byKey.values()];
}

async function scrapeMessagesToday(page: Page, options?: { mineOnly?: boolean }): Promise<ScrapedMessage[]> {
  const window = getTodayWindow();
  const raw = await extractRawMessages(page);
  const mineOnly = options?.mineOnly !== false;

  return raw
    .map((m) => {
      const dayContext = normalizeDayContext(m.dayContext);
      return {
        author: m.author,
        timestamp: m.timestamp,
        body: cleanBody(m.body),
        dayContext,
        dayContextRaw: m.dayContext,
        parsedTimestamp: parseSlackTimestamp(m.timestamp, window.realToday),
      };
    })
    .filter((m) => m.body.length > 2)
    .filter((m) => (mineOnly ? isMyAuthor(m.author) : true))
    .filter((m) => isTodaysMessage(m, window));
}

async function scrapeMyMessagesToday(page: Page): Promise<ScrapedMessage[]> {
  return scrapeMessagesToday(page, { mineOnly: true });
}

export async function getMyMessagesToday(page: Page, channelName: string): Promise<string[]> {
  await openChannel(page, channelName);
  const messages = await scrapeMyMessagesToday(page);
  log(`#${channelName.replace(/^#/, '')}: ${messages.length} message(s) from ${config.slack.displayName} today`);
  return messages.map((m) => m.body);
}

/**
 * Delete today's EOD: messages from the configured EOD channel so a corrected post can be sent.
 * Returns how many messages were deleted.
 */
export async function deleteTodaysEod(page: Page): Promise<number> {
  await openChannel(page, 'eod');
  await page.waitForTimeout(800);
  await page
    .evaluate(`(() => {
      const panes = [...document.querySelectorAll('[data-qa="slack_kit_list"], .c-virtual_list__scroll_container')];
      const el = panes.find((p) => p.scrollHeight > 200) || document.scrollingElement;
      if (el) el.scrollTop = el.scrollHeight;
    })()`)
    .catch(() => {});
  await page.waitForTimeout(1000);

  let deleted = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // Don't reopen channel each loop — just re-scan DOM
    const myName = JSON.stringify(config.slack.displayName.trim().toLowerCase());
    const found = await page.evaluate(`(() => {
      document.querySelectorAll('[data-eod-delete-target]').forEach((el) => el.removeAttribute('data-eod-delete-target'));
      const myName = ${myName};
      let lastSender = '';
      const containers = [...document.querySelectorAll('[data-qa="message_container"]')];
      for (const el of containers) {
        const senderRaw =
          ((el.querySelector('[data-qa="message_sender_name"]') || {}).textContent || '').trim() ||
          ((el.querySelector('[data-qa="message_sender"]') || {}).textContent || '').trim();
        if (senderRaw) lastSender = senderRaw.toLowerCase();
        const sender = (senderRaw || lastSender).toLowerCase();
        if (!sender.includes(myName) && myName !== sender) continue;
        const bodyNode = el.querySelector('[data-qa="message-text"]');
        const body = (bodyNode && bodyNode.innerText ? bodyNode.innerText : '').trim();
        if (!/^\\s*EOD\\s*:/i.test(body)) continue;
        el.scrollIntoView({ block: 'center' });
        el.setAttribute('data-eod-delete-target', '1');
        return body.slice(0, 80);
      }
      return null;
    })()`);

    if (!found) {
      log(`No more EOD: messages in DOM (deleted so far: ${deleted})`);
      break;
    }
    log(`Delete target found: ${String(found).replace(/\n/g, ' / ')}`);

    const target = page.locator('[data-eod-delete-target="1"]').first();
    const text = target.locator('[data-qa="message-text"]').first();
    await text.hover({ timeout: 5000 }).catch(() => target.hover({ timeout: 5000 }).catch(() => {}));
    await page.waitForTimeout(400);

    // Hover toolbar is often a sibling / portal — prefer visible More actions near the message
    let openedMenu = false;
    const moreCandidates = page.locator(
      'button[data-qa="more_actions"], button[aria-label="More actions"], button[aria-label*="More actions"]'
    );
    const moreCount = await moreCandidates.count();
    for (let i = moreCount - 1; i >= 0; i -= 1) {
      const btn = moreCandidates.nth(i);
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 3000 }).catch(() => {});
        openedMenu = true;
        break;
      }
    }
    if (!openedMenu) {
      await text.click({ button: 'right', timeout: 5000 }).catch(() =>
        target.click({ button: 'right', timeout: 5000 })
      );
    }
    await page.waitForTimeout(600);

    const deleteItem = page
      .locator(
        '[role="menuitem"]:has-text("Delete message"), ' +
          '[data-qa="delete_message"], ' +
          'button:has-text("Delete message"), ' +
          'div.c-menu_item__label:has-text("Delete message")'
      )
      .first();

    if ((await deleteItem.count()) === 0 || !(await deleteItem.isVisible().catch(() => false))) {
      log('Could not find Delete message menu item — stopping delete loop');
      await page.keyboard.press('Escape').catch(() => {});
      break;
    }
    await deleteItem.click();
    await page.waitForTimeout(600);

    const confirm = page
      .locator(
        'button[data-qa="dialog_go"], ' +
          '[data-qa="dialog_body"] button:has-text("Delete"), ' +
          'button[type="submit"]:has-text("Delete"), ' +
          '.c-dialog__footer button:has-text("Delete")'
      )
      .first();
    if ((await confirm.count()) > 0) {
      await confirm.click();
      deleted += 1;
      log(`Deleted today's EOD message (#${deleted})`);
      await page.waitForTimeout(1500);
    } else {
      log('Delete confirm dialog not found — stopping');
      await page.keyboard.press('Escape').catch(() => {});
      break;
    }
  }

  // Final verification (reopens channel)
  const remaining = await hasTodaysEod(page);
  log(
    `deleteTodaysEod done — removed ${deleted} message(s); ` +
      `remaining EOD today=${remaining ? 'yes' : 'no'}`
  );
  return deleted;
}

/** True if YOU already posted an EOD: in the configured EOD channel today. */
export async function hasTodaysEod(page: Page): Promise<boolean> {
  await openChannel(page, 'eod');
  await page.waitForTimeout(800);
  await page
    .evaluate(`(() => {
      const panes = [...document.querySelectorAll('[data-qa="slack_kit_list"], .c-virtual_list__scroll_container')];
      const el = panes.find((p) => p.scrollHeight > 200) || document.scrollingElement;
      if (el) el.scrollTop = el.scrollHeight;
    })()`)
    .catch(() => {});
  await page.waitForTimeout(800);

  const messages = await scrapeMessagesToday(page, { mineOnly: true });
  const found = messages.some((m) => /^\s*EOD\s*:/i.test(m.body));
  log(
    `Duplicate EOD check: ${found ? 'found your EOD today' : 'none found'} ` +
      `(scanned ${messages.length} of your message(s) today)`
  );
  return found;
}

export async function postToChannel(
  page: Page,
  channelName: string,
  message: string,
  options?: { skipDuplicateGuard?: boolean }
): Promise<void> {
  if (!message.trim()) throw new Error('Empty EOD message');

  await openChannel(page, channelName);

  if (config.dryRun) {
    log(`DRY RUN — would post to #${channelName.replace(/^#/, '')}`);
    return;
  }

  // Final guard inside post path — never send twice in one day (unless force replace)
  if (!options?.skipDuplicateGuard) {
    const already = await hasTodaysEod(page);
    if (already) {
      log('Skip send — EOD: already present in channel today (single-post guard)');
      return;
    }
  } else {
    log('Force post — skipping duplicate EOD guard');
  }

  const composer = page.locator('[data-qa="message_input"]').first();
  await composer.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  await composer.click();
  await page.waitForTimeout(200);

  // Insert directly — never use OS clipboard
  const insertResult = (await page.evaluate(`(text) => {
    const el = document.querySelector('[data-qa="message_input"]');
    if (!el) return { ok: false, reason: 'no-composer' };
    el.focus();
    try {
      document.execCommand('selectAll', false);
      document.execCommand('delete', false);
    } catch (e) {}
    try {
      const ok = document.execCommand('insertText', false, text);
      const draft = (el.innerText || el.textContent || '').trim();
      return { ok: ok && /EOD\\s*:/i.test(draft), draftPreview: draft.slice(0, 80), mode: 'insertText' };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  }`, message)) as { ok?: boolean; draftPreview?: string; mode?: string; reason?: string };

  if (!insertResult?.ok) {
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    const lines = message.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i]) await page.keyboard.type(lines[i], { delay: 5 });
      if (i < lines.length - 1) await page.keyboard.press('Shift+Enter');
    }
  }

  await page.waitForTimeout(400);
  const draftText = ((await composer.innerText().catch(() => '')) || '').trim();
  if (!/EOD\s*:/i.test(draftText)) {
    throw new Error(
      `Refusing to send — composer does not contain EOD draft.\n` +
        `Draft preview: "${draftText.slice(0, 120)}"`
    );
  }
  log(`Composer ready (preview: ${draftText.slice(0, 60).replace(/\n/g, ' / ')}…)`);

  // ONE send attempt only (no second Enter — that caused duplicate posts)
  const send = page.locator(
    '[data-qa="texty_send_button"], button[aria-label="Send now"], button[aria-label="Send message"]'
  );
  if ((await send.count()) > 0 && (await send.first().isEnabled().catch(() => false))) {
    await send.first().click();
    log('Send: clicked Slack send button (single attempt)');
  } else {
    await composer.click();
    await page.keyboard.press('Enter');
    log('Send: pressed Enter once (single attempt)');
  }

  await page.waitForTimeout(2500);
  await page
    .evaluate(`(() => {
      const panes = [...document.querySelectorAll('[data-qa="slack_kit_list"], .c-virtual_list__scroll_container')];
      const el = panes.find((p) => p.scrollHeight > 200) || document.scrollingElement;
      if (el) el.scrollTop = el.scrollHeight;
    })()`)
    .catch(() => {});
  await page.waitForTimeout(1000);

  const confirmed = await hasTodaysEod(page);
  if (!confirmed) {
    const leftover = ((await composer.innerText().catch(() => '')) || '').trim();
    throw new Error(
      `Single send completed but EOD: not found in channel.\n` +
        `Composer leftover: "${leftover.slice(0, 120)}"\n` +
        `Not retrying automatically (prevents duplicates).`
    );
  }

  log(`Posted to #${channelName.replace(/^#/, '')} (verified once)`);
}
