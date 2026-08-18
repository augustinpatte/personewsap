import type { SupabaseClient } from "@supabase/supabase-js";

import type { DailyDropSlot, Language } from "../domain.js";
import type {
  NotificationCandidateDrop,
  NotificationCandidateToken,
  ReceiptOutcome
} from "./editionNotification.js";
import type { DeliveryRecord, PushNotificationStore } from "./pushSender.js";

/**
 * The Supabase side of edition notifications.
 *
 * Runs with the service-role key, server-side only: it reads across readers to
 * find who should be told, which no client is ever allowed to do. Nothing here
 * belongs in the mobile app, and the key must never reach it.
 *
 * Idempotency is the unique index plus an atomic claim RPC. A row existing is
 * not enough: only rows returned by claim_push_notification_deliveries may
 * proceed to Expo, so two workers racing on the same token/date/kind cannot
 * both continue after an ignored conflict.
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

      const { data: preferences, error: preferencesError } = await supabase
        .from("user_preferences")
        .select("user_id,newsletter_enabled,business_stories_enabled,mini_cases_enabled")
        .in(
          "user_id",
          rows.map((row) => row.user_id)
        );

      if (preferencesError) {
        throw new Error(
          `Could not read user module preferences for ${dropDate}: ${preferencesError.message}`
        );
      }

      const requiredSlotsByUserId = new Map<string, DailyDropSlot[]>();
      for (const preference of (preferences ?? []) as Array<{
        user_id: string;
        newsletter_enabled: boolean | null;
        business_stories_enabled: boolean | null;
        mini_cases_enabled: boolean | null;
      }>) {
        requiredSlotsByUserId.set(preference.user_id, requiredEditionSlotsForPreference(preference));
      }

      return rows.map<NotificationCandidateDrop>((row) => ({
        dailyDropId: row.id,
        userId: row.user_id,
        language: row.language,
        status: row.status,
        slots: slotsByDropId.get(row.id) ?? [],
        requiredSlots: requiredSlotsByUserId.get(row.user_id)
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
        .select("push_token_id,drop_date,notification_kind,status,attempt_count,expo_ticket_id")
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
          expo_ticket_id: string | null;
        };

        return {
          pushTokenId: delivery.push_token_id,
          dropDate: delivery.drop_date,
          notificationKind: delivery.notification_kind,
          status: delivery.status,
          attemptCount: delivery.attempt_count,
          expoTicketId: delivery.expo_ticket_id
        };
      });
    },

    async claimDeliveries(rows) {
      if (rows.length === 0) {
        return new Set();
      }

      const { data, error } = await supabase.rpc("claim_push_notification_deliveries", {
        p_claim_id: crypto.randomUUID(),
        p_claim_ttl_seconds: 900,
        p_rows: rows.map((row) => ({
          push_token_id: row.pushTokenId,
          user_id: row.userId,
          drop_date: row.dropDate,
          notification_kind: row.notificationKind
        }))
      });

      if (error) {
        throw new Error(`Could not claim notification deliveries: ${error.message}`);
      }

      return new Set(
        ((data ?? []) as Array<{ push_token_id: string }>).map((row) => row.push_token_id)
      );
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
      // An accepted ticket is not final delivery. It waits for receipt
      // reconciliation; retryable send failures become retryable rows.
      const status =
        outcome.kind === "ticket_accepted"
          ? "awaiting_receipt"
          : outcome.kind === "permanent" || outcome.kind === "token_invalid"
            ? "terminal_failure"
            : "retryable_failure";

      const { error } = await supabase
        .from("push_notification_deliveries")
        .update({
          status,
          expo_ticket_id: outcome.kind === "ticket_accepted" ? outcome.expoTicketId : null,
          attempt_count: attemptCount,
          last_attempt_at: attemptedAt,
          sent_at: null,
          error: outcome.kind === "ticket_accepted" ? null : outcome.error
        })
        .eq("push_token_id", pushTokenId)
        .eq("drop_date", dropDate)
        .eq("notification_kind", notificationKind);

      if (error) {
        throw new Error(`Could not record notification delivery: ${error.message}`);
      }
    },

    async loadAwaitingReceipts(limit) {
      const { data, error } = await supabase
        .from("push_notification_deliveries")
        .select("push_token_id,drop_date,notification_kind,status,attempt_count,expo_ticket_id")
        .in("status", ["ticket_accepted", "awaiting_receipt"])
        .not("expo_ticket_id", "is", null)
        .order("last_attempt_at", { ascending: true, nullsFirst: true })
        .limit(limit);

      if (error) {
        throw new Error(`Could not read awaiting push receipts: ${error.message}`);
      }

      return (data ?? []).map<DeliveryRecord>((row) => {
        const delivery = row as {
          push_token_id: string;
          drop_date: string;
          notification_kind: string;
          status: DeliveryRecord["status"];
          attempt_count: number;
          expo_ticket_id: string | null;
        };

        return {
          pushTokenId: delivery.push_token_id,
          dropDate: delivery.drop_date,
          notificationKind: delivery.notification_kind,
          status: delivery.status,
          attemptCount: delivery.attempt_count,
          expoTicketId: delivery.expo_ticket_id
        };
      });
    },

    async recordReceiptResult({ pushTokenId, dropDate, notificationKind, outcome, checkedAt }) {
      const status = receiptStatus(outcome);
      const { error } = await supabase
        .from("push_notification_deliveries")
        .update({
          status,
          expo_receipt_checked_at: checkedAt,
          sent_at: outcome.kind === "sent" ? checkedAt : null,
          error: outcome.kind === "sent" ? null : outcome.error
        })
        .eq("push_token_id", pushTokenId)
        .eq("drop_date", dropDate)
        .eq("notification_kind", notificationKind);

      if (error) {
        throw new Error(`Could not record push receipt: ${error.message}`);
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

function requiredEditionSlotsForPreference(preference: {
  newsletter_enabled: boolean | null;
  business_stories_enabled: boolean | null;
  mini_cases_enabled: boolean | null;
}): DailyDropSlot[] {
  return [
    preference.newsletter_enabled === false ? null : "newsletter",
    preference.business_stories_enabled === false ? null : "business_story",
    preference.mini_cases_enabled === false ? null : "mini_case"
  ].filter((slot): slot is DailyDropSlot => Boolean(slot));
}

function receiptStatus(outcome: ReceiptOutcome): DeliveryRecord["status"] {
  if (outcome.kind === "sent") {
    return "sent";
  }
  if (outcome.kind === "retryable") {
    return "retryable_failure";
  }
  return "terminal_failure";
}
