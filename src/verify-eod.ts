import { closeSlackSession, loginToSlack } from './login';
import { openChannel } from './slack';

async function main() {
  const session = await loginToSlack();
  try {
    await openChannel(session.page, 'eod');
    await session.page.waitForTimeout(3500);
    await session.page.evaluate(`(() => {
      const panes = [...document.querySelectorAll('[data-qa="slack_kit_list"], .c-virtual_list__scroll_container')];
      const el = panes.find((p) => p.scrollHeight > 200) || document.scrollingElement;
      if (el) el.scrollTop = el.scrollHeight;
    })()`);
    await session.page.waitForTimeout(1500);

    const msgs = await session.page.evaluate(`(() => {
      return [...document.querySelectorAll('[data-qa="message_container"]')].slice(-15).map((el) => {
        const author = (el.querySelector('[data-qa="message_sender_name"]') || {}).textContent || '';
        const bodyNode = el.querySelector('[data-qa="message-text"]');
        const body = (bodyNode && bodyNode.innerText ? bodyNode.innerText : '').trim().slice(0, 220);
        const tsEl = el.querySelector('a[aria-label], [data-qa="message_timestamp"]');
        const ts = (tsEl && tsEl.getAttribute('aria-label')) || '';
        return { author: author.trim(), ts, body };
      });
    })()`);

    console.log(JSON.stringify(msgs, null, 2));
    const hasEod = (msgs as Array<{ body: string }>).some((m) => /^\s*EOD\s*:/i.test(m.body));
    console.log(hasEod ? 'FOUND_EOD=yes' : 'FOUND_EOD=no');
  } finally {
    await closeSlackSession(session);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
