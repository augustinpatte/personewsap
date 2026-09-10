import { getCalendars } from "expo-localization";

import { resolveCurrentDeviceTimeZone } from "./profileTimezone";

/**
 * The IANA zone the phone is in at this moment, for `profiles.timezone`.
 *
 * `expo-localization` reads it from the OS on every call. The JS engine's
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` is only the fallback: it
 * is the engine's own notion of the zone, and a reader who lands in Chicago
 * with the app still alive must be written as Chicago the moment the app
 * returns to the foreground.
 */
export function readCurrentDeviceTimeZone(): string | null {
  return resolveCurrentDeviceTimeZone({
    native: () => getCalendars()[0]?.timeZone,
    intl: () => Intl.DateTimeFormat().resolvedOptions().timeZone
  });
}
