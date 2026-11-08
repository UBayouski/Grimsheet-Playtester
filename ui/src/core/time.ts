// Time functions. Pure and total: no clock is read, nothing throws.
import { getOwn } from './json';
import { TIME_UNKNOWN } from './text';

/** The Stale_Limit: 36 hours in milliseconds. */
export const STALE_LIMIT_MS = 129_600_000;

const MAX_DATE_MS = 8.64e15;

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] ?? 0;
}

/**
 * An ISO 8601 date and time with a `T`, at least hours and minutes, and `Z` or an offset, as milliseconds
 * since the epoch. Every field is range-checked by hand (no use of Date.parse, whose handling of an
 * impossible day differs between engines). Anything else gives null.
 */
export function parseTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = ISO_PATTERN.exec(value);
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const millis = m[7] === undefined ? 0 : Number(m[7].slice(0, 3).padEnd(3, '0'));
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMinutes = 0;
  const zone = m[8] ?? 'Z';
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMinutes = (zone.startsWith('-') ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millis);
  const ms = date.getTime() - offsetMinutes * 60_000;
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_DATE_MS ? ms : null;
}

/**
 * A time field of /api/crons: a finite number at least 0 (seconds below 1e11, milliseconds from there) or
 * an ISO 8601 string. Anything else gives null.
 */
export function parseCronTime(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    const ms = value < 1e11 ? value * 1000 : value;
    return ms <= MAX_DATE_MS ? ms : null;
  }
  return parseTime(value);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** `YYYY-MM-DD HH:MM UTC` (the minute is floored), or "time unknown". */
export function formatUtc(ms: number | null): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || Math.abs(ms) > MAX_DATE_MS) return TIME_UNKNOWN;
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  if (year < 0 || year > 9999) return TIME_UNKNOWN;
  return `${pad(year, 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)} ${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)} UTC`;
}

/**
 * True exactly when the time is a number, `nowMs` is a finite number, and the time is more than the
 * Stale_Limit before `nowMs`. A time exactly 36 hours old is not stale.
 */
export function isStale(replayMs: number | null, nowMs: unknown): boolean {
  if (replayMs === null || typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return false;
  return nowMs - replayMs > STALE_LIMIT_MS;
}

/**
 * The time of a `latest` run: `finishedAt` when it is a string, otherwise `startedAt`. A `finishedAt`
 * string that does not parse gives null (there is no fallback to `startedAt` in that case).
 */
export function replayTimeOf(latest: Record<string, unknown>): number | null {
  const finishedAt = getOwn(latest, 'finishedAt');
  return parseTime(typeof finishedAt === 'string' ? finishedAt : getOwn(latest, 'startedAt'));
}