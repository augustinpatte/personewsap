import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { supabase } from "../../lib/supabase";
import { useAuth } from "../auth";
import { readCurrentDeviceTimeZone } from "./deviceTimeZone";
import { shouldSyncProfileTimezone } from "./profileTimezone";

/**
 * Keeps `profiles.timezone` on the device's current zone.
 *
 * Checked when the signed-in app opens and every time it returns to the
 * foreground — which is exactly when a traveller's phone has just changed
 * zone. The write is conditional (`neq`), so an unchanged zone costs one
 * no-op request per session at most, and nothing is logged.
 */
export function useProfileTimezoneSync(): void {
  const { status, user } = useAuth();
  const lastSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    const client = supabase;

    if (status !== "ready" || !user?.id || !client) {
      return;
    }

    const userId = user.id;

    const sync = () => {
      // Read from the OS now, not captured at launch: this runs again on every
      // return to the foreground, which is when a traveller's zone has moved.
      const deviceTimeZone = readCurrentDeviceTimeZone();

      if (
        !deviceTimeZone ||
        !shouldSyncProfileTimezone({ deviceTimeZone, lastSyncedTimeZone: lastSyncedRef.current })
      ) {
        return;
      }

      lastSyncedRef.current = deviceTimeZone;

      void client
        .from("profiles")
        .update({ timezone: deviceTimeZone })
        .eq("id", userId)
        .neq("timezone", deviceTimeZone)
        .then(({ error }) => {
          if (error) {
            // Try again on the next foreground rather than never.
            lastSyncedRef.current = null;
          }
        });
    };

    sync();

    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        sync();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [status, user?.id]);
}
