import type { RefreshSchedule } from '../config/defaults.js';

/**
 * Schedule arithmetic, kept free of the database so it can be tested directly.
 *
 * Everything is expressed as an instant (UTC) but *computed* in the
 * institution's own zone: "2am Sunday" has to mean 2am where the college is,
 * not 2am on whatever the server happens to be set to, and it has to keep
 * meaning that across a daylight-saving change.
 */

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86_400_000;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Reads the wall-clock fields an instant shows in a given zone. */
export function partsInZone(instant: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl renders midnight as "24" in some zones.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: Math.max(0, WEEKDAYS.indexOf(parts.weekday ?? 'Sun')),
  };
}

/** How far the zone is from UTC at a given instant, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant.getTime();
}

/**
 * Turns a wall-clock time in a zone into the instant it happens.
 *
 * Two passes: the first guesses using the offset at the naive instant, the
 * second corrects it if that guess landed on the other side of a DST boundary.
 *
 * Spring-forward leaves an hour that never happens — 02:30 does not exist in
 * New York on the morning the clocks jump 02:00 to 03:00. Both passes then
 * produce a time that is not the one asked for, and the earlier of them sits
 * *before* the requested hour, which would run a nightly job an hour early. In
 * that case the later candidate is used, so a job scheduled inside the gap runs
 * at the first moment that exists rather than before it.
 */
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstGuess = new Date(naive - offsetMs(new Date(naive), timeZone));
  const corrected = new Date(naive - offsetMs(firstGuess, timeZone));

  const landed = partsInZone(corrected, timeZone);
  const hitTheRequestedTime = landed.hour === hour && landed.minute === minute;
  if (hitTheRequestedTime) return corrected;

  return firstGuess > corrected ? firstGuess : corrected;
}

/** Re-derives the instant from a date's own wall clock in the schedule's zone. */
function anchorTo(instant: Date, schedule: RefreshSchedule): Date {
  const p = partsInZone(instant, schedule.timezone);
  return zonedTimeToInstant(p.year, p.month, p.day, schedule.hour, schedule.minute, schedule.timezone);
}

/**
 * The most recent scheduled occurrence at or before `now`.
 * Returns null when the schedule is disabled or its zone is unusable.
 */
export function previousOccurrence(schedule: RefreshSchedule, now: Date): Date | null {
  if (!schedule.enabled || !isValidTimeZone(schedule.timezone)) return null;

  const local = partsInZone(now, schedule.timezone);
  const todaysSlot = zonedTimeToInstant(
    local.year,
    local.month,
    local.day,
    schedule.hour,
    schedule.minute,
    schedule.timezone,
  );

  if (schedule.frequency === 'daily') {
    // Step back a whole local day, then re-anchor so a DST change cannot drift
    // the wall-clock time we promised.
    return todaysSlot <= now ? todaysSlot : anchorTo(new Date(todaysSlot.getTime() - DAY_MS), schedule);
  }

  // Weekly: how many local days back the configured weekday is.
  const daysSinceTarget = (local.weekday - schedule.dayOfWeek + 7) % 7;
  const stepBackDays = daysSinceTarget === 0 && todaysSlot > now ? 7 : daysSinceTarget;

  return stepBackDays === 0 ? todaysSlot : anchorTo(new Date(todaysSlot.getTime() - stepBackDays * DAY_MS), schedule);
}

/** The next occurrence strictly after `now` — shown in the UI as "next run". */
export function nextOccurrence(schedule: RefreshSchedule, now: Date): Date | null {
  const previous = previousOccurrence(schedule, now);
  if (!previous) return null;

  const stepDays = schedule.frequency === 'daily' ? 1 : 7;
  let candidate = anchorTo(new Date(previous.getTime() + stepDays * DAY_MS), schedule);

  // A DST shift can leave the re-anchored instant at or behind `now`.
  if (candidate <= now) candidate = anchorTo(new Date(candidate.getTime() + stepDays * DAY_MS), schedule);
  return candidate;
}

export interface DueSlot {
  scheduledFor: Date;
  lateByMinutes: number;
  /** False when the slot was missed by more than the grace window. */
  withinGrace: boolean;
}

/**
 * The slot that should run now, if any.
 *
 * A slot missed by more than the grace window is reported as out of grace: the
 * caller records it as skipped rather than kicking off a full refresh at an
 * hour nobody expects, after (say) a three-day outage.
 */
export function dueSlot(schedule: RefreshSchedule, now: Date): DueSlot | null {
  const previous = previousOccurrence(schedule, now);
  if (!previous) return null;

  const lateByMinutes = Math.floor((now.getTime() - previous.getTime()) / 60_000);
  return { scheduledFor: previous, lateByMinutes, withinGrace: lateByMinutes <= schedule.graceMinutes };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Human-readable summary, e.g. "Every Sunday at 02:00 (Asia/Kolkata)". */
export function describeSchedule(schedule: RefreshSchedule): string {
  if (!schedule.enabled) return 'Automatic refresh is off';
  const time = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`;
  const when =
    schedule.frequency === 'daily'
      ? `Every day at ${time}`
      : `Every ${DAY_NAMES[schedule.dayOfWeek] ?? 'Sunday'} at ${time}`;
  return `${when} (${schedule.timezone})`;
}
