import { config, escapeRegExp } from './config';

export type TaskUpdate = {
  title: string;
  comment: string;
};

/** New task block often starts with #1001: … */
const TASK_TITLE_LINE = /^#\d+\s*:/;

function pmTaskUrlPattern(): RegExp {
  const host = escapeRegExp(config.taskUrlHost);
  // Match configured PM host task URLs, or a generic /projects/{id}/tasks/{id} path
  return new RegExp(
    `(?:https?:\\/\\/)?${host}\\/projects\\/\\d+\\/tasks\\/\\d+|projects\\/\\d+\\/tasks\\/\\d+`,
    'i'
  );
}

function isPmTaskUrl(line: string): boolean {
  return pmTaskUrlPattern().test(line);
}

function isNoiseMessage(raw: string): boolean {
  const text = String(raw || '');
  return (
    /Tasks Synced from Microsoft Teams/i.test(text) ||
    /To-do list shared by client/i.test(text) ||
    /via Cursor Automation/i.test(text) ||
    /To-do list\s*:/i.test(text)
  );
}

function isNoiseTitle(title: string): boolean {
  const t = title.trim();
  return (
    /^Hi\s+@/i.test(t) ||
    /^Date\s*:/i.test(t) ||
    /^Channel\s*:/i.test(t) ||
    /^Follow\s*up\s*:/i.test(t) ||
    /^@\w+/i.test(t) ||
    /^Priority\s*:/i.test(t)
  );
}

/**
 * Parse Slack task-update message bodies.
 *
 * Real updates look like:
 *   #1001: Issues | Sample investigation title
 *   https://pm.example.com/projects/100/tasks/2001
 *   Status note goes here
 *
 * One Slack message may contain multiple such blocks.
 * Assignments, Teams to-do dumps, and @mentions without a PM link are ignored.
 */
export function parseTaskUpdates(messages: string[]): TaskUpdate[] {
  const updates: TaskUpdate[] = [];

  for (const raw of messages) {
    if (isNoiseMessage(raw)) continue;

    const lines = String(raw || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 3) continue;

    const urlIndexes: number[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (isPmTaskUrl(lines[i])) urlIndexes.push(i);
    }
    if (!urlIndexes.length) continue;

    for (let u = 0; u < urlIndexes.length; u += 1) {
      const urlIndex = urlIndexes[u];
      const nextUrlIndex = u + 1 < urlIndexes.length ? urlIndexes[u + 1] : lines.length;

      let title = '';
      for (let i = urlIndex - 1; i >= 0; i -= 1) {
        if (isPmTaskUrl(lines[i])) break;
        title = lines[i];
        break;
      }
      if (!title || isPmTaskUrl(title) || isNoiseTitle(title)) continue;

      const commentParts: string[] = [];
      for (let i = urlIndex + 1; i < nextUrlIndex; i += 1) {
        const line = lines[i];
        if (isPmTaskUrl(line)) break;
        if (TASK_TITLE_LINE.test(line) && u + 1 < urlIndexes.length) break;
        commentParts.push(line);
      }

      const comment = commentParts.join(' ').trim();
      if (!comment || isPmTaskUrl(comment) || isNoiseTitle(comment)) continue;

      updates.push({ title, comment });
    }
  }

  return updates;
}

export function formatUpdateLine(update: TaskUpdate): string {
  return `• ${update.title} - ${update.comment}`;
}

export function buildEodMessage(updates: TaskUpdate[]): string {
  if (!updates.length) return '';
  const lines = updates.map(formatUpdateLine);
  return `EOD:\n\n${lines.join('\n\n')}`;
}
