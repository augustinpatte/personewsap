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
  /**
   * True only when this edition is KNOWN to have been written and not yet
   * verified.
   *
   * The event path cannot announce such an edition — `claim_notification_events`
   * does not see an `awaiting_verification` row — but the fallback schedule
   * derives its date from the cadence and would announce it anyway, which would
   * put the same hole back in a different pipe. This is what closes it.
   *
   * It answers false whenever it does not know: no row, outbox not deployed,
   * table unreachable. An edition with no verification record behaves exactly as
   * it did before this table existed, because the alternative is a sender that
   * goes silent the day the outbox has a bad afternoon.
   */
  isAwaitingVerification: (input: { eventDate: string }) => Promise<boolean>;
  /**
   * Editions verified in the last three days. A reader in Los Angeles is told
   * about Monday's edition at 19:00 Los Angeles, which is early Tuesday in
   * Paris: by then neither the event nor the cadence date names Monday, so the
   * run has to ask which recent editions may still have readers to tell.
   * Answers [] when it cannot know, which is the behaviour before this existed.
   */
  recentReleasedEditionDates: () => Promise<string[]>;
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
    },

    async isAwaitingVerification({ eventDate }) {
      const { data, error } = await supabase
        .from("notification_outbox")
        .select("status")
        .eq("event_type", "edition_published")
        .eq("event_date", eventDate)
        .maybeSingle();

      if (error) {
        if (MISSING_FUNCTION_CODES.has(error.code ?? "")) {
          return false;
        }

        console.error("[content-engine] could not read the notification outbox", {
          code: error.code ?? null,
          message: error.message
        });
        return false;
      }

      return (data as { status?: string } | null)?.status === "awaiting_verification";
    },

    async recentReleasedEditionDates() {
      const { data, error } = await supabase.rpc("get_recent_released_edition_dates", {});

      if (error) {
        if (!MISSING_FUNCTION_CODES.has(error.code ?? "")) {
          console.error("[content-engine] could not list recent released editions", {
            code: error.code ?? null,
            message: error.message
          });
        }

        return [];
      }

      return ((data ?? []) as Array<{ released_edition_date: string }>).map(
        (row) => row.released_edition_date
      );
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
  /** Recently verified editions whose later-timezone readers may now be due. */
  recentDates?: string[];
}): string[] {
  const dates = new Set<string>();

  for (const event of input.events) {
    if (event.eventType === "edition_published") {
      dates.add(event.eventDate);
    }
  }

  for (const date of input.recentDates ?? []) {
    dates.add(date);
  }

  if (input.fallbackDate) {
    dates.add(input.fallbackDate);
  }

  return [...dates].sort();
}
