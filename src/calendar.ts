import { config } from './config';

export const TIMEZONE = config.timezone;

export type LocalDateParts = {
  year: number;
  month: number;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
};

export function localDateParts(date: Date = new Date()): LocalDateParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function dateKey(parts: { year: number; month: number; day: number }): string {
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${parts.year}-${m}-${d}`;
}

export function addCalendarDays(
  parts: { year: number; month: number; day: number },
  deltaDays: number
): LocalDateParts {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + deltaDays, 6, 0, 0));
  return localDateParts(utc);
}

export function sameDay(
  a: { year: number; month: number; day: number },
  b: { year: number; month: number; day: number }
): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function isWeekday(parts: { weekday: string }): boolean {
  return !['Sat', 'Sun'].includes(parts.weekday);
}

export type TodayWindow = {
  timezone: string;
  realToday: LocalDateParts;
  target: { year: number; month: number; day: number };
};

export function getTodayWindow(now: Date = new Date()): TodayWindow {
  const realToday = localDateParts(now);
  return {
    timezone: TIMEZONE,
    realToday,
    target: {
      year: realToday.year,
      month: realToday.month,
      day: realToday.day,
    },
  };
}
