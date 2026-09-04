import { describe, expect, it } from "vitest";

import type { Language } from "../domain.js";
import {
  buildEditionNotificationMessage,
  isExpoPushToken,
  resolveEditionNotificationRecipients,
  type NotificationCandidateDrop,
  type NotificationCandidateToken
} from "./editionNotification.js";

/**
 * The reader's language is a property of the READER, resolved when the
 * notification is sent — never of the edition, and never of the device row.
 *
 * An edition is published at 19:00 in whatever language the reader had then,
 * and is deliberately never rewritten afterwards (past editions keep their
 * history). The notification goes out at 19:10. A reader who switched language
 * in between — or a week ago, on an edition being retried — must be told in the
 * language they read in now. Announcing in the edition's stored language is
 * what made "I switched to English and PersoNews still writes me in French"
 * possible.
 */

const READER = "11111111-1111-4111-8111-111111111111";
const SECOND_READER = "22222222-2222-4222-8222-222222222222";
const DROP_DATE = "2026-09-04";

function drop(overrides: Partial<NotificationCandidateDrop> = {}): NotificationCandidateDrop {
  return {
    dailyDropId: "drop-1",
    userId: READER,
    language: "fr",
    status: "published",
    slots: ["newsletter", "business_story", "mini_case"],
    ...overrides
  };
}

function token(overrides: Partial<NotificationCandidateToken> = {}): NotificationCandidateToken {
  return {
    pushTokenId: "token-1",
    userId: READER,
    expoPushToken: "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]",
    enabled: true,
    ...overrides
  };
}

function resolve(input: {
  drops: NotificationCandidateDrop[];
  tokens: NotificationCandidateToken[];
  currentLanguages?: Record<string, Language>;
  notificationsEnabled?: string[];
}) {
  const tokensByUserId = new Map<string, NotificationCandidateToken[]>();

  for (const entry of input.tokens) {
    tokensByUserId.set(entry.userId, [...(tokensByUserId.get(entry.userId) ?? []), entry]);
  }

  return resolveEditionNotificationRecipients({
    dropDate: DROP_DATE,
    drops: input.drops,
    tokensByUserId,
    notificationsEnabledUserIds: new Set(
      input.notificationsEnabled ?? input.drops.map((entry) => entry.userId)
    ),
    languagesByUserId: input.currentLanguages
      ? new Map(Object.entries(input.currentLanguages))
      : undefined
  });
}

describe("edition notification copy", () => {
  it("uses the product wording in French", () => {
    const message = buildEditionNotificationMessage("fr", DROP_DATE);

    expect(message.title).toBe("Votre édition du jour est arrivée");
    expect(message.body).toBe("Venez la découvrir dans PersoNews.");
    expect(message.data).toEqual({ type: "edition_ready", drop_date: DROP_DATE });
  });

  it("uses the product wording in English", () => {
    const message = buildEditionNotificationMessage("en", DROP_DATE);

    expect(message.title).toBe("Today's edition is here");
    expect(message.body).toBe("Come discover it in PersoNews.");
  });

  it("carries the edition date so a tap can open that edition", () => {
    expect(buildEditionNotificationMessage("fr", DROP_DATE).data.drop_date).toBe(DROP_DATE);
  });
});

describe("language is resolved at send time", () => {
  it("TEST 7: a reader whose profile is French is told in French", () => {
    const { recipients } = resolve({
      drops: [drop({ language: "fr" })],
      tokens: [token()],
      currentLanguages: { [READER]: "fr" }
    });

    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.language).toBe("fr");
    expect(recipients[0]?.message.title).toBe("Votre édition du jour est arrivée");
  });

  it("TEST 8: a reader whose profile is English is told in English", () => {
    const { recipients } = resolve({
      drops: [drop({ language: "en" })],
      tokens: [token()],
      currentLanguages: { [READER]: "en" }
    });

    expect(recipients[0]?.language).toBe("en");
    expect(recipients[0]?.message.title).toBe("Today's edition is here");
  });

  it("TEST 9: a device registered while French gets English after the reader switches", () => {
    // The edition itself was published in French — it is never rewritten — and
    // the device row carries no language at all. Only the profile moved.
    const { recipients } = resolve({
      drops: [drop({ language: "fr" })],
      tokens: [token()],
      currentLanguages: { [READER]: "en" }
    });

    expect(recipients[0]?.message.title).toBe("Today's edition is here");
    expect(recipients[0]?.message.body).toBe("Come discover it in PersoNews.");
  });

  it("TEST 10: switching back to French returns the French copy on the same device", () => {
    const { recipients } = resolve({
      drops: [drop({ language: "en" })],
      tokens: [token()],
      currentLanguages: { [READER]: "fr" }
    });

    expect(recipients[0]?.message.title).toBe("Votre édition du jour est arrivée");
  });

  it("survives a full fr -> en -> fr -> en cycle with no drift", () => {
    const titles = (["fr", "en", "fr", "en"] as const).map((language) => {
      const { recipients } = resolve({
        drops: [drop({ language: "fr" })],
        tokens: [token()],
        currentLanguages: { [READER]: language }
      });

      return recipients[0]?.message.title;
    });

    expect(titles).toEqual([
      "Votre édition du jour est arrivée",
      "Today's edition is here",
      "Votre édition du jour est arrivée",
      "Today's edition is here"
    ]);
  });

  it("falls back to the edition's language when the profile could not be read", () => {
    const { recipients } = resolve({
      drops: [drop({ language: "fr" })],
      tokens: [token()],
      currentLanguages: {}
    });

    expect(recipients[0]?.language).toBe("fr");
  });

  it("keeps each reader on their own language in the same run", () => {
    const { recipients } = resolve({
      drops: [
        drop({ userId: READER, language: "fr" }),
        drop({ dailyDropId: "drop-2", userId: SECOND_READER, language: "fr" })
      ],
      tokens: [
        token(),
        token({ pushTokenId: "token-2", userId: SECOND_READER })
      ],
      currentLanguages: { [READER]: "en", [SECOND_READER]: "fr" }
    });

    expect(recipients.find((entry) => entry.userId === READER)?.message.title).toBe(
      "Today's edition is here"
    );
    expect(recipients.find((entry) => entry.userId === SECOND_READER)?.message.title).toBe(
      "Votre édition du jour est arrivée"
    );
  });
});

describe("TEST 11: multiple devices", () => {
  it("sends the same current-language copy to every device of one reader", () => {
    const { recipients } = resolve({
      // Two devices registered at different times, one while the reader was
      // French. Language belongs to the account, so both must say the same.
      drops: [drop({ language: "fr" })],
      tokens: [
        token({ pushTokenId: "iphone" }),
        token({
          pushTokenId: "ipad",
          expoPushToken: "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]"
        })
      ],
      currentLanguages: { [READER]: "en" }
    });

    expect(recipients).toHaveLength(2);
    expect(new Set(recipients.map((entry) => entry.message.title))).toEqual(
      new Set(["Today's edition is here"])
    );
    // One delivery row per device: the idempotency key is the device.
    expect(new Set(recipients.map((entry) => entry.pushTokenId))).toEqual(
      new Set(["iphone", "ipad"])
    );
  });
});

describe("TEST 13: tokens Expo cannot accept", () => {
  it("recognises Expo push tokens and rejects raw device tokens", () => {
    expect(isExpoPushToken("ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[aaaaaaaaaaaaaaaaaaaaaa]")).toBe(true);
    // A native APNs device token, which is what addPushTokenListener reports.
    expect(isExpoPushToken("fe71701d317f4c0a9b2d8e6f10a3c5b7".repeat(2))).toBe(false);
    expect(isExpoPushToken("")).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[]")).toBe(false);
  });

  it("never sends to a raw device token and reports it for retirement", () => {
    const nativeToken = token({
      pushTokenId: "apns-row",
      expoPushToken: "fe71701d317f4c0a9b2d8e6f10a3c5b7fe71701d317f4c0a9b2d8e6f10a3c5b7"
    });

    const { recipients, invalidTokens } = resolve({
      drops: [drop()],
      tokens: [token({ pushTokenId: "expo-row" }), nativeToken],
      currentLanguages: { [READER]: "fr" }
    });

    expect(recipients.map((entry) => entry.pushTokenId)).toEqual(["expo-row"]);
    expect(invalidTokens.map((entry) => entry.pushTokenId)).toEqual(["apns-row"]);
  });

  it("treats a reader whose only device is unusable as having no device", () => {
    const { recipients, skipped, invalidTokens } = resolve({
      drops: [drop()],
      tokens: [token({ expoPushToken: "not-a-token" })],
      currentLanguages: { [READER]: "fr" }
    });

    expect(recipients).toHaveLength(0);
    expect(skipped).toEqual([{ userId: READER, reason: "no_enabled_token" }]);
    expect(invalidTokens).toHaveLength(1);
  });
});

describe("TEST 5: the account preference still decides", () => {
  it("sends nothing to a reader who turned notifications off, whatever their language", () => {
    const { recipients, skipped } = resolve({
      drops: [drop()],
      tokens: [token()],
      notificationsEnabled: [],
      currentLanguages: { [READER]: "en" }
    });

    expect(recipients).toHaveLength(0);
    expect(skipped).toEqual([{ userId: READER, reason: "notifications_disabled" }]);
  });
});
