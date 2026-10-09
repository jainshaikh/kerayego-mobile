// Trip times are absolute UTC instants, but the schema fixes how they are
// shown: always in Pakistan time (Trip.departureAt, prisma/schema.prisma),
// never the phone's own zone — the same rule web's lib/utils/datetime.ts
// applies. Pakistan has no DST, so the offset is a constant.
export const TRIP_TIMEZONE = 'Asia/Karachi';
const TRIP_UTC_OFFSET_MINUTES = 5 * 60;

function formatInTripZone(iso: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return date.toLocaleString(undefined, { ...options, timeZone: TRIP_TIMEZONE });
  } catch {
    // A JS engine without time zone data would throw on `timeZone` — show
    // the phone's own zone rather than nothing.
    return date.toLocaleString(undefined, options);
  }
}

/** e.g. "Thursday, October 8, 2026 at 9:30 PM", in Pakistan time. */
export function formatTripDateTime(
  iso: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'short' },
): string {
  return formatInTripZone(iso, options);
}

/** e.g. "9:30 PM", in Pakistan time. */
export function formatTripTime(iso: string): string {
  return formatInTripZone(iso, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Whether the phone's clock is already on Pakistan time, so a trip time needs
 * no "Pakistan time" hint next to it. `getTimezoneOffset` is minutes BEHIND
 * UTC, hence the sign.
 */
export function isDeviceInTripTimezone(deviceOffsetMinutes: number = new Date().getTimezoneOffset()): boolean {
  return deviceOffsetMinutes === -TRIP_UTC_OFFSET_MINUTES;
}

/** " (Pakistan time)" after a trip time, unless the phone already shows Pakistan time. */
export function tripTimeZoneSuffix(deviceOffsetMinutes?: number): string {
  return isDeviceInTripTimezone(deviceOffsetMinutes) ? '' : ' (Pakistan time)';
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count !== 1 ? 's' : ''}`;
}

export interface DepartureCountdown {
  label: string;
  // departureAt has come and gone.
  past: boolean;
}

/**
 * "Departs in 2 h 5 min" / "Departs in 3 days 4 h" — whole minutes rounded up,
 * so it never reads "0 min" while there is still time left. null for an
 * unparseable departure time.
 */
export function formatDepartureCountdown(departureAt: string, nowMs: number): DepartureCountdown | null {
  const departureMs = Date.parse(departureAt);
  if (!Number.isFinite(departureMs) || !Number.isFinite(nowMs)) return null;

  const remainingMs = departureMs - nowMs;
  if (remainingMs <= 0) return { label: 'Departure time has passed', past: true };
  if (remainingMs < 60_000) return { label: 'Departs in under a minute', past: false };

  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  let span: string;
  if (days > 0) span = hours > 0 ? `${plural(days, 'day')} ${hours} h` : plural(days, 'day');
  else if (hours > 0) span = minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  else span = `${minutes} min`;
  return { label: `Departs in ${span}`, past: false };
}
