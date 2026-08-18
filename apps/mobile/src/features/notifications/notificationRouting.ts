/**
 * Where a tapped notification takes the reader.
 *
 * There is exactly one notification in the product — "your edition is ready" —
 * so there is exactly one destination: the Newsletter tab, which is the front
 * page of an edition. No dedicated screen, no special stack, no deep link into
 * a reader: the existing navigation already puts today's edition there, and the
 * archive already holds the rest.
 *
 * Parsing is kept pure and defensive: a payload is data from outside the app,
 * so anything unrecognised routes nowhere rather than crashing a cold start.
 */

export const EDITION_READY_NOTIFICATION = "edition_ready";
export const NEWSLETTER_ROUTE = "/(tabs)/newsletter";

export type NotificationRoute = {
  pathname: typeof NEWSLETTER_ROUTE;
  /** The edition the notification was about, when it named one. */
  dropDate: string | null;
};

const DROP_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function resolveNotificationRoute(data: unknown): NotificationRoute | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const payload = data as { type?: unknown; drop_date?: unknown };

  if (payload.type !== EDITION_READY_NOTIFICATION) {
    return null;
  }

  const dropDate =
    typeof payload.drop_date === "string" && DROP_DATE_PATTERN.test(payload.drop_date)
      ? payload.drop_date
      : null;

  return { pathname: NEWSLETTER_ROUTE, dropDate };
}

/**
 * Whether a route may be followed yet.
 *
 * A cold start from a notification arrives before the session is known. Routing
 * then would fight the auth redirect, so the tap is held until auth is ready
 * and the reader is past onboarding — after which it is applied once.
 */
export function canFollowNotificationRoute(authStatus: string): boolean {
  return authStatus === "ready";
}
