/**
 * UTC calendar date of a timestamp.
 *
 * NOT the editorial date. Use getProductEditionDate() from
 * scheduler/editionCadence.js to decide which edition "today" is: this helper
 * follows UTC, which is exactly what put the job a day behind the app between
 * midnight and 01:00/02:00 Paris. Keep this for converting a concrete
 * timestamp (an article's published_at, a run's created_at) to a date.
 */
export function toDateOnly(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function daysBetween(later: Date, earlier: Date): number {
  return Math.max(0, (later.getTime() - earlier.getTime()) / 86_400_000);
}
