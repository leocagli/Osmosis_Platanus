/**
 * Date formatting utilities — all dates display in GMT-3 (Argentina time).
 *
 * Uses the IANA timezone "America/Argentina/Buenos_Aires" via Intl.DateTimeFormat
 * so dates render consistently regardless of the user's browser locale/timezone.
 */

const TZ = "America/Argentina/Buenos_Aires";

/** Format a date as "HH:MM" in GMT-3 */
export function formatTimeGMT3(date: string | Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(date));
}

/** Format a date as "DD/MM/YYYY" in GMT-3 */
export function formatDateGMT3(date: string | Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

/** Format a date as "DD/MM/YYYY HH:MM" in GMT-3 */
export function formatDateTimeGMT3(date: string | Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(date));
}

/** Format a deadline with label: "DD/MM/YYYY HH:MM (GMT-3)" */
export function formatDeadlineGMT3(date: string | Date): string {
  return `${formatDateTimeGMT3(date)} (GMT-3)`;
}

/** Get current hour (0-23) in GMT-3 — used for day/night cycle */
export function getArgentinaHour(): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hourPart = parts.find((p) => p.type === "hour");
  return hourPart ? parseInt(hourPart.value, 10) : 0;
}
