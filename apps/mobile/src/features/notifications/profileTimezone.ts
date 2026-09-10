/**
 * `profiles.timezone` is the one authority the server uses to decide WHEN a
 * reader is notified: 19:00 for the edition, 08:30 for the next-morning
 * reminder, both in that zone. It is written from the device, and has to follow
 * the reader when they travel — a reader who lands in Chicago and opens the app
 * must be reminded at 08:30 Chicago, not 08:30 Paris.
 *
 * Only a real IANA Region/City name is ever written (or bare UTC). An offset or
 * an abbreviation would be read by the server as the product's own zone, so
 * writing one would be worse than writing nothing.
 */

const IANA_ZONE_PATTERN = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/;

export function isWritableTimeZone(timeZone: string | null | undefined): timeZone is string {
  return typeof timeZone === "string" && (IANA_ZONE_PATTERN.test(timeZone) || timeZone === "UTC");
}

/**
 * The device's zone right now: the OS calendar's zone first, the JS engine's
 * Intl zone only as a fallback. Intl is the engine's own notion of the zone,
 * and nothing here can show that it refreshes when the OS zone changes while
 * the app stays alive; the native read asks the OS on every call.
 */
export function resolveCurrentDeviceTimeZone(readers: {
  native: () => string | null | undefined;
  intl: () => string | null | undefined;
}): string | null {
  for (const read of [readers.native, readers.intl]) {
    try {
      const zone = read();

      if (isWritableTimeZone(zone)) {
        return zone;
      }
    } catch {
      // Try the next source.
    }
  }

  return null;
}

export function shouldSyncProfileTimezone(input: {
  deviceTimeZone: string | null | undefined;
  lastSyncedTimeZone: string | null;
}): boolean {
  return isWritableTimeZone(input.deviceTimeZone) && input.deviceTimeZone !== input.lastSyncedTimeZone;
}
