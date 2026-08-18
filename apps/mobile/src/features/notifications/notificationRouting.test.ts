import { describe, expect, it } from "vitest";

import {
  canFollowNotificationRoute,
  EDITION_READY_NOTIFICATION,
  NEWSLETTER_ROUTE,
  resolveNotificationRoute
} from "./notificationRouting";

/**
 * A notification payload is data from outside the app, and a cold start applies
 * it before anything is rendered. It is parsed defensively here so a malformed
 * or unknown payload routes nowhere instead of breaking the launch.
 */
describe("resolveNotificationRoute", () => {
  it("opens the Newsletter tab for a published edition", () => {
    expect(
      resolveNotificationRoute({ type: EDITION_READY_NOTIFICATION, drop_date: "2026-08-17" })
    ).toEqual({ pathname: NEWSLETTER_ROUTE, dropDate: "2026-08-17" });
  });

  it("still routes when the payload carries no usable date", () => {
    // The destination does not depend on the date: the tab shows the current
    // edition either way.
    for (const dropDate of [undefined, null, "", "17/08/2026", 20260817]) {
      expect(
        resolveNotificationRoute({ type: EDITION_READY_NOTIFICATION, drop_date: dropDate })
      ).toEqual({ pathname: NEWSLETTER_ROUTE, dropDate: null });
    }
  });

  it("ignores anything that is not our notification", () => {
    for (const payload of [
      null,
      undefined,
      "edition_ready",
      42,
      {},
      { type: "marketing" },
      { type: "streak_reminder", drop_date: "2026-08-17" },
      { drop_date: "2026-08-17" }
    ]) {
      expect(resolveNotificationRoute(payload)).toBeNull();
    }
  });
});

describe("canFollowNotificationRoute", () => {
  it("waits for a ready session before navigating", () => {
    expect(canFollowNotificationRoute("ready")).toBe(true);
    // Routing during these would fight the auth/onboarding redirect.
    expect(canFollowNotificationRoute("loading")).toBe(false);
    expect(canFollowNotificationRoute("signedOut")).toBe(false);
    expect(canFollowNotificationRoute("needsOnboarding")).toBe(false);
  });
});

describe("the payload the sender writes matches what the app reads", () => {
  it("agrees on the type and the field name", async () => {
    const { buildEditionNotificationMessage } = await import(
      "../../../../../services/content-engine/src/notifications/editionNotification"
    );
    const message = buildEditionNotificationMessage("fr", "2026-08-17");

    // The contract between the two halves of the feature, asserted in one place.
    expect(resolveNotificationRoute(message.data)).toEqual({
      pathname: NEWSLETTER_ROUTE,
      dropDate: "2026-08-17"
    });
  });
});
