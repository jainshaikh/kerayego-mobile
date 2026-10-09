import { describe, expect, it } from '@jest/globals';

import {
  formatDepartureCountdown,
  formatTripDateTime,
  formatTripTime,
  isDeviceInTripTimezone,
  tripTimeZoneSuffix,
} from './tripDateTime';

const DEPARTURE = '2026-10-09T04:00:00.000Z';
const departureMs = Date.parse(DEPARTURE);
const MIN = 60_000;

describe('formatDepartureCountdown', () => {
  it('counts whole minutes, rounded up so it never reads "0 min" early', () => {
    expect(formatDepartureCountdown(DEPARTURE, departureMs - 5 * MIN)).toEqual({ label: 'Departs in 5 min', past: false });
    expect(formatDepartureCountdown(DEPARTURE, departureMs - 4 * MIN - 1)).toEqual({ label: 'Departs in 5 min', past: false });
  });

  it('says "under a minute" for the last minute', () => {
    expect(formatDepartureCountdown(DEPARTURE, departureMs - 59_999)).toEqual({
      label: 'Departs in under a minute',
      past: false,
    });
  });

  it('shows hours and minutes, dropping zero minutes', () => {
    expect(formatDepartureCountdown(DEPARTURE, departureMs - 125 * MIN)?.label).toBe('Departs in 2 h 5 min');
    expect(formatDepartureCountdown(DEPARTURE, departureMs - 120 * MIN)?.label).toBe('Departs in 2 h');
  });

  it('shows days and hours (with plural days) beyond a day', () => {
    expect(formatDepartureCountdown(DEPARTURE, departureMs - (3 * 24 * 60 + 4 * 60) * MIN)?.label).toBe(
      'Departs in 3 days 4 h',
    );
    expect(formatDepartureCountdown(DEPARTURE, departureMs - 24 * 60 * MIN)?.label).toBe('Departs in 1 day');
  });

  it('flags a departure time that has passed', () => {
    expect(formatDepartureCountdown(DEPARTURE, departureMs)).toEqual({ label: 'Departure time has passed', past: true });
    expect(formatDepartureCountdown(DEPARTURE, departureMs + MIN)?.past).toBe(true);
  });

  it('is null for an unreadable time', () => {
    expect(formatDepartureCountdown('not a date', departureMs)).toBeNull();
    expect(formatDepartureCountdown(DEPARTURE, Number.NaN)).toBeNull();
  });
});

describe('trip times are shown in Pakistan time (UTC+5), whatever the phone zone', () => {
  it('formats the time in Asia/Karachi', () => {
    // 04:00 UTC is 09:00 in Karachi.
    expect(formatTripTime(DEPARTURE)).toMatch(/^9:00\s?AM$/);
  });

  it('formats the full date and time in Asia/Karachi, across a date boundary', () => {
    // 21:30 UTC on the 8th is 02:30 on the 9th in Karachi.
    const formatted = formatTripDateTime('2026-10-08T21:30:00.000Z');
    expect(formatted).toMatch(/\b9\b/);
    expect(formatted).not.toMatch(/\b8\b/);
    expect(formatted).toMatch(/2:30\s?AM/);
  });

  it('shows a dash for an unreadable time', () => {
    expect(formatTripTime('nope')).toBe('—');
  });
});

describe('isDeviceInTripTimezone / tripTimeZoneSuffix', () => {
  it('recognises a phone already on UTC+5 (getTimezoneOffset is minutes behind UTC)', () => {
    expect(isDeviceInTripTimezone(-300)).toBe(true);
    expect(tripTimeZoneSuffix(-300)).toBe('');
  });

  it('labels the time for a phone elsewhere (e.g. Riyadh, UTC+3)', () => {
    expect(isDeviceInTripTimezone(-180)).toBe(false);
    expect(tripTimeZoneSuffix(-180)).toBe(' (Pakistan time)');
  });
});
