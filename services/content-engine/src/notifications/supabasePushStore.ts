import type { SupabaseClient } from "@supabase/supabase-js";

import type { DailyDropSlot, Language } from "../domain.js";
import type {
  NotificationCandidateDrop,
  NotificationCandidateToken
} from "./editionNotification.js";
import type { DeliveryRecord, PushNotificationStore } from "./pushSender.js";

/**
 * The Supabase side of edition notifications.
 *
 * Runs with the service-role key, server-side only: it reads across readers to
 * find who should be told, which no client is ever allowed to do. Nothing here
 * belongs in the mobile app, and the key must never reach it.
 *
 * The whole idempotency guarantee is the unique index on
 * (push_token_id, drop_date, notification_kind): reserveDeliveries inserts and
 * ignores conflicts, so replaying a run cannot create a second delivery for a
 * device that already has one.
 */

const PUBLISHED_DROP_STATUSES = ["published"] as const;

export function createSupabasePushNotificationStore(
  supabase: SupabaseClient
): PushNotificationStore {
  return {
    async loadEditionDrops({ dropDate, languages }) {
      let query = supabase
        .from("daily_drops")
        .select("id,user_id,language,status")
        .eq("drop_date", dropDate)
        .in("status", [...PUBLISHED_DROP_STATUSES]);

      if (languages && languages.length > 0) {
        query = query.in("language", languages);
      }

      const { data: drops, error } = await query;

      if (error) {
        throw new Error(`Could not read published drops for ${dropDate}: ${error.message}`);
      }

      const rows = (drops ?? []) as Array<{
        id: string;
        user_id: string;
        language: Language;
        status: string;
      }>;

      if (rows.length === 0) {
        return [];
      }

      // The slots actually linked, so an edition missing its business story is
      // never announced as complete.
      const { data: items, error: itemsError } = await supabase
        .from("daily_drop_items")
        .select("daily_drop_id,slot")
        .in(
          "daily_drop_id",
          rows.map((row) => row.id)
        );

      if (itemsError) {
        throw new Error(
          `Could not read drop items for ${dropDate}: ${itemsError.message}`
        );
      }

      const slotsByDropId = new Map<string, DailyDropSlot[]>();

      for (const item of (items ?? []) as Array<{
        daily_drop_id: string;
        slot: DailyDropSlot;
      }>) {
        slotsByDropId.set(item.daily_drop_id, [
          ...(slotsByDropId.get(item.daily_drop_id) ?? []),
          item.slot
        ]);
      }

      return rows.map<NotificationCandidateDrop>((row) => ({
        dailyDropId: row.id,
        userId: row.user_id,
        language: row.language,
        status: row.status,
        slots: slotsByDropId.get(row.id) ?? []
      }));
    },

    async loadNotificationsEnabledUserIds(userIds) {
      if (userIds.length === 0) {
        return new Set();
      }

      const { data, error } = await supabase
        .from("user_preferences")
        .select("user_id,notifications_enabled")
        .in("user_id", userIds)
        .eq("notifications_enabled", true);

      if (error) {
        throw new Error(`Could not read notification preferences: ${error.message}`);
      }

      return new Set((data ?? []).map((row) => (row as { user_id: string }).user_id));
    },

    async loadEnabledPushTokens(userIds) {
      if (userIds.length === 0) {
        return [];
      }

      const { data, error } = await supabase
        .from("push_tokens")
        .select("id,user_id,expo_push_token,enabled")
        .in("user_id", userIds)
        .eq("enabled", true);

      if (error) {
        throw new Error(`Could not read push tokens: ${error.message}`);
      }

      return (data ?? []).map<NotificationCandidateToken>((row) => {
        const token = row as {
          id: string;
          user_id: string;
          expo_push_token: string;
          enabled: boolean;
        };

        return {
          pushTokenId: token.id,
          userId: token.user_id,
          expoPushToken: token.expo_push_token,
          enabled: token.enabled
        };
      });
    },

    async loadDeliveries({ dropDate, notificationKind }) {
      const { data, error } = await supabase
        .from("push_notification_deliveries")
        .select("push_token_id,drop_date,notification_kind,status,attempt_count")
        .eq("drop_date", dropDate)
        .eq("notification_kind", notificationKind);

      if (error) {
        throw new Error(`Could not read notification deliveries: ${error.message}`);
      }

      return (data ?? []).map<DeliveryRecord>((row) => {
        const delivery = row as {
          push_token_id: string;
          drop_date: string;
          notification_kind: string;
          status: DeliveryRecord["status"];
          attempt_count: number;
        };

        return {
          pushTokenId: delivery.push_token_id,
          dropDate: delivery.drop_date,
          notificationKind: delivery.notification_kind,
          status: delivery.status,
          attemptCount: delivery.attempt_count
        };
      });
    },

    async reserveDeliveries(rows) {
      if (rows.length === 0) {
        return;
      }

      // ignoreDuplicates: an existing row for this device and edition is the
      // record that a previous run already handled it. Never overwritten.
      const { error } = await supabase.from("push_notification_deliveries").upsert(
        rows.map((row) => ({
          push_token_id: row.pushTokenId,
          user_id: row.userId,
          drop_date: row.dropDate,
          notification_kind: row.notificationKind,
          status: "pending"
        })),
        { onConflict: "push_token_id,drop_date,notification_kind", ignoreDuplicates: true }
      );

      if (error) {
        throw new Error(`Could not reserve notification deliveries: ${error.message}`);
      }
    },

    async recordDeliveryResult({
      pushTokenId,
      dropDate,
      notificationKind,
      outcome,
      attemptedAt
    }) {
      const { data: existing, error: readError } = await supabase
        .from("push_notification_deliveries")
        .select("attempt_count")
        .eq("push_token_id", pushTokenId)
        .eq("drop_date", dropDate)
        .eq("notification_kind", notificationKind)
        .maybeSingle();

      if (readError) {
        throw new Error(`Could not read delivery attempt count: ${readError.message}`);
      }

      const attemptCount = ((existing as { attempt_count?: number } | null)?.attempt_count ?? 0) + 1;
      // Only "sent" and "permanent" are terminal. A retryable outcome stays
      // pending so the next run picks it up again.
      const status =
        outcome.kind === "sent"
          ? "sent"
          : outcome.kind === "permanent" || outcome.kind === "token_invalid"
            ? "failed"
            : "pending";

      const { error } = await supabase
        .from("push_notification_deliveries")
        .update({
          status,
          expo_ticket_id: outcome.kind === "sent" ? outcome.expoTicketId : null,
          attempt_count: attemptCount,
          last_attempt_at: attemptedAt,
          sent_at: outcome.kind === "sent" ? attemptedAt : null,
          error: outcome.kind === "sent" ? null : outcome.error
        })
        .eq("push_token_id", pushTokenId)
        .eq("drop_date", dropDate)
        .eq("notification_kind", notificationKind);

      if (error) {
        throw new Error(`Could not record notification delivery: ${error.message}`);
      }
    },

    async disablePushToken(pushTokenId, reason) {
      const { error } = await supabase
        .from("push_tokens")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("id", pushTokenId);

      if (error) {
        throw new Error(
          `Could not disable push token after "${reason}": ${error.message}`
        );
      }
    }
  };
}
