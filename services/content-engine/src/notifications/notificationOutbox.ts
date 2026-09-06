import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The consumer side of `public.notification_outbox`.
 *
 * An edition being published writes an event in the same transaction that
 * publishes it. This is what picks that event up, so the thing that causes
 * readers to be told is the publication itself rather than a cron expression
 * guessed to run some minutes after it.
 *
 * Everything here degrades to "no events". The outbox is an accelerator, not
 * the guarantee: if the migration is not applied yet, if the RPC is missing, if
 * the table is unreachable, the caller falls back to sending for the edition
 * date it was going to send for anyway. A notification arriving late is a much
 * smaller failure than a notification not arriving, and a much smaller one than
 * a sender that refuses to run.
 */

export type NotificationEvent = {
  eventId: string;
  eventType: string;
  eventDate: string;
  attemptCount: number;
};

export type NotificationOutbox = {
  /** Leases up to `limit` events. An unavailable outbox yields none. */
  claimEvents: (input: { limit: number }) => Promise<NotificationEvent[]>;
  /** Releases an event: processed on success, retryable otherwise. */
  completeEvent: (input: {
    eventId: string;
    succeeded: boolean;
    error?: string;
  }) => Promise<void>;
};

/** The outbox has not been deployed to this project yet. */
const MISSING_FUNCTION_CODES = new Set(["PGRST202", "PGRST203", "42883", "42P01"]);

export function createSupabaseNotificationOutbox(supabase: SupabaseClient): NotificationOutbox {
  const claimId = `content-engine-${crypto.randomUUID()}`;

  return {
    async claimEvents({ limit }) {
      const { data, error } = await supabase.rpc("claim_notification_events", {
        p_claim_id: claimId,
        p_limit: Math.max(1, Math.trunc(limit)),
        p_claim_ttl_seconds: 900
      });

      if (error) {
        if (MISSING_FUNCTION_CODES.has(error.code ?? "")) {
          console.info("[content-engine] notification outbox is not deployed yet", {
            code: error.code ?? null
          });
          return [];
        }

        // Not fatal: the caller still has an edition date to send for.
        console.error("[content-engine] could not claim notification events", {
          code: error.code ?? null,
          message: error.message
        });
        return [];
      }

      return ((data ?? []) as Array<{
        claimed_event_id: string;
        claimed_event_type: string;
        claimed_event_date: string;
        claimed_attempt_count: number;
      }>).map<NotificationEvent>((row) => ({
        eventId: row.claimed_event_id,
        eventType: row.claimed_event_type,
        eventDate: row.claimed_event_date,
        attemptCount: row.claimed_attempt_count
      }));
    },

    async completeEvent({ eventId, succeeded, error: failureReason }) {
      const { error } = await supabase.rpc("complete_notification_event", {
        p_event_id: eventId,
        p_succeeded: succeeded,
        p_error: failureReason ?? null
      });

      if (error) {
        // The lease expires on its own, so a failure to release one costs a
        // delayed retry and nothing else.
        console.error("[content-engine] could not complete a notification event", {
          code: error.code ?? null,
          message: error.message
        });
      }
    }
  };
}

/**
 * The dates one run should announce.
 *
 * The event dates first, because they are facts about editions that exist, then
 * the caller's own date — today's edition under the cadence, or whatever `--date`
 * named. Both, deduplicated: an event tells us an edition published, and the
 * absence of an event never proves one did not.
 */
export function resolveEditionDatesToAnnounce(input: {
  events: NotificationEvent[];
  fallbackDate: string | null;
}): string[] {
  const dates = new Set<string>();

  for (const event of input.events) {
    if (event.eventType === "edition_published") {
      dates.add(event.eventDate);
    }
  }

  if (input.fallbackDate) {
    dates.add(input.fallbackDate);
  }

  return [...dates].sort();
}
