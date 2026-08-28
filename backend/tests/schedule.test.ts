import { describe, expect, it } from 'vitest';
import {
  describeSchedule,
  dueSlot,
  nextOccurrence,
  partsInZone,
  previousOccurrence,
  zonedTimeToInstant,
} from '../src/services/schedule.service.js';
import { DEFAULT_REFRESH_SCHEDULE, type RefreshSchedule } from '../src/config/defaults.js';

const schedule = (overrides: Partial<RefreshSchedule> = {}): RefreshSchedule => ({
  ...DEFAULT_REFRESH_SCHEDULE,
  enabled: true,
  ...overrides,
});

/** What wall clock does this instant show in that zone? */
const wall = (instant: Date, zone: string) => {
  const p = partsInZone(instant, zone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};

describe('zone conversion', () => {
  it('maps a wall-clock time in a zone to the right instant', () => {
    // 02:00 IST is 20:30 UTC the previous day.
    const instant = zonedTimeToInstant(2026, 3, 15, 2, 0, 'Asia/Kolkata');
    expect(instant.toISOString()).toBe('2026-03-14T20:30:00.000Z');
  });

  it('handles a zone that observes daylight saving', () => {
    // New York is UTC-5 in January and UTC-4 in July.
    expect(zonedTimeToInstant(2026, 1, 15, 2, 0, 'America/New_York').toISOString()).toBe('2026-01-15T07:00:00.000Z');
    expect(zonedTimeToInstant(2026, 7, 15, 2, 0, 'America/New_York').toISOString()).toBe('2026-07-15T06:00:00.000Z');
  });
});

describe('previous occurrence', () => {
  it('returns null when the schedule is off', () => {
    expect(previousOccurrence(schedule({ enabled: false }), new Date())).toBeNull();
  });

  it('returns null for an unusable time zone rather than guessing', () => {
    expect(previousOccurrence(schedule({ timezone: 'Not/AZone' }), new Date())).toBeNull();
  });

  it('finds today\'s slot once it has passed', () => {
    const config = schedule({ frequency: 'daily', hour: 2, minute: 0, timezone: 'Asia/Kolkata' });
    // 09:00 IST on 20 Aug — 02:00 the same morning has already gone.
    const now = new Date('2026-08-20T03:30:00Z');
    expect(wall(previousOccurrence(config, now)!, 'Asia/Kolkata')).toBe('2026-08-20 02:00');
  });

  it('steps back a day when today\'s slot has not arrived', () => {
    const config = schedule({ frequency: 'daily', hour: 2, minute: 0, timezone: 'Asia/Kolkata' });
    // 01:00 IST on 20 Aug — 02:00 is still ahead.
    const now = new Date('2026-08-19T19:30:00Z');
    expect(wall(previousOccurrence(config, now)!, 'Asia/Kolkata')).toBe('2026-08-19 02:00');
  });

  it('finds the configured weekday for a weekly schedule', () => {
    // Sundays at 02:00 IST. 20 Aug 2026 is a Thursday.
    const config = schedule({ frequency: 'weekly', dayOfWeek: 0, hour: 2, minute: 0, timezone: 'Asia/Kolkata' });
    const previous = previousOccurrence(config, new Date('2026-08-20T03:30:00Z'))!;
    expect(wall(previous, 'Asia/Kolkata')).toBe('2026-08-16 02:00');
    expect(partsInZone(previous, 'Asia/Kolkata').weekday).toBe(0);
  });

  it('does not jump forward when today IS the weekday but the time has not come', () => {
    // Sunday 16 Aug at 01:00 IST — the 02:00 slot is still ahead, so the
    // previous occurrence is the Sunday before.
    const config = schedule({ frequency: 'weekly', dayOfWeek: 0, hour: 2, minute: 0, timezone: 'Asia/Kolkata' });
    const previous = previousOccurrence(config, new Date('2026-08-15T19:30:00Z'))!;
    expect(wall(previous, 'Asia/Kolkata')).toBe('2026-08-09 02:00');
  });

  it('keeps the promised wall-clock time across a daylight-saving change', () => {
    // US DST starts 8 March 2026. A daily 02:30 job must stay at 02:30 local.
    const config = schedule({ frequency: 'daily', hour: 2, minute: 30, timezone: 'America/New_York' });
    for (const iso of ['2026-03-07T12:00:00Z', '2026-03-09T12:00:00Z', '2026-03-12T12:00:00Z']) {
      expect(wall(previousOccurrence(config, new Date(iso))!, 'America/New_York')).toMatch(/ 02:30$/);
    }
  });
});

describe('next occurrence', () => {
  it('is always in the future', () => {
    const now = new Date('2026-08-20T03:30:00Z');
    for (const config of [
      schedule({ frequency: 'daily' }),
      schedule({ frequency: 'weekly', dayOfWeek: 3 }),
      schedule({ frequency: 'daily', timezone: 'America/New_York' }),
    ]) {
      expect(nextOccurrence(config, now)!.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it('is exactly one interval after the previous one', () => {
    const config = schedule({ frequency: 'weekly', dayOfWeek: 0, timezone: 'Asia/Kolkata' });
    const now = new Date('2026-08-20T03:30:00Z');
    const previous = previousOccurrence(config, now)!;
    const next = nextOccurrence(config, now)!;
    expect(Math.round((next.getTime() - previous.getTime()) / 86_400_000)).toBe(7);
  });

  it('never lands before the requested time when the clocks spring forward', () => {
    // 02:30 does not exist in New York on 8 March 2026 (02:00 jumps to 03:00).
    // The job must not end up running at 01:30, an hour EARLY.
    const config = schedule({ frequency: 'daily', hour: 2, minute: 30, timezone: 'America/New_York' });
    const next = nextOccurrence(config, new Date('2026-03-07T12:00:00Z'))!;
    const landed = partsInZone(next, 'America/New_York');
    expect(landed.day).toBe(8);
    expect(landed.hour).toBeGreaterThanOrEqual(2);
  });

  it('resolves a non-existent local time forward to the first instant that exists', () => {
    const instant = zonedTimeToInstant(2026, 3, 8, 2, 30, 'America/New_York');
    // The gap resolves to 03:30 EDT, not 01:30 EST.
    expect(wall(instant, 'America/New_York')).toBe('2026-03-08 03:30');
  });
});

describe('due slot', () => {
  it('reports a slot inside the grace window as runnable', () => {
    const config = schedule({ frequency: 'daily', hour: 2, minute: 0, timezone: 'Asia/Kolkata', graceMinutes: 720 });
    // 03:00 IST, one hour after the slot.
    const due = dueSlot(config, new Date('2026-08-20T21:30:00Z'))!;
    expect(due.withinGrace).toBe(true);
    expect(due.lateByMinutes).toBeLessThan(720);
  });

  it('reports a long-missed slot as out of grace rather than firing it late', () => {
    const config = schedule({ frequency: 'weekly', dayOfWeek: 0, hour: 2, minute: 0, timezone: 'Asia/Kolkata', graceMinutes: 60 });
    // Thursday: the Sunday slot is days old.
    const due = dueSlot(config, new Date('2026-08-20T03:30:00Z'))!;
    expect(due.withinGrace).toBe(false);
    expect(due.lateByMinutes).toBeGreaterThan(60);
  });

  it('returns nothing when disabled', () => {
    expect(dueSlot(schedule({ enabled: false }), new Date())).toBeNull();
  });
});

describe('description', () => {
  it('describes the schedule in plain language', () => {
    expect(describeSchedule(schedule({ frequency: 'weekly', dayOfWeek: 0, hour: 2, minute: 0, timezone: 'Asia/Kolkata' })))
      .toBe('Every Sunday at 02:00 (Asia/Kolkata)');
    expect(describeSchedule(schedule({ frequency: 'daily', hour: 23, minute: 30, timezone: 'UTC' })))
      .toBe('Every day at 23:30 (UTC)');
    expect(describeSchedule(schedule({ enabled: false }))).toBe('Automatic refresh is off');
  });
});
