import type { Language, TopicId } from "../types/domain";

export const ANALYTICS_EVENTS = [
  "app_opened",
  "onboarding_started",
  "onboarding_completed",
  "daily_drop_loaded",
  "daily_drop_empty",
  "content_item_opened",
  "content_item_completed",
  "content_item_saved",
  "topic_preference_updated",
  "language_updated",
  "auth_signed_in",
  "auth_signed_out",
  "error_viewed"
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export type AnalyticsContentType =
  | "newsletter_article"
  | "business_story"
  | "mini_case"
  | "key_concept"
  | "concept"
  | "quick_quiz";

export type AnalyticsEventProperties = {
  content_type?: AnalyticsContentType;
  drop_date?: string;
  item_id?: string;
  language?: Language;
  topic?: TopicId;
};

type AnalyticsProvider = {
  track: (event: AnalyticsEventName, properties: AnalyticsEventProperties) => void | Promise<void>;
};

const analyticsEndpoint = process.env.EXPO_PUBLIC_ANALYTICS_ENDPOINT?.trim();
const analyticsWriteKey = process.env.EXPO_PUBLIC_ANALYTICS_WRITE_KEY?.trim();
const analyticsProviderName =
  process.env.EXPO_PUBLIC_ANALYTICS_PROVIDER?.trim() || "custom_http";
const analyticsDebugEnabled = process.env.EXPO_PUBLIC_ANALYTICS_DEBUG === "true";

const analyticsProvider: AnalyticsProvider | null =
  analyticsEndpoint && analyticsWriteKey
    ? createHttpAnalyticsProvider({
        endpoint: analyticsEndpoint,
        providerName: analyticsProviderName,
        writeKey: analyticsWriteKey
      })
    : null;

export function trackAnalyticsEvent(
  event: AnalyticsEventName,
  properties: AnalyticsEventProperties = {}
) {
  if (!analyticsProvider) {
    debugAnalytics("noop", event, sanitizeAnalyticsProperties(properties));
    return;
  }

  const safeProperties = sanitizeAnalyticsProperties(properties);

  void Promise.resolve(analyticsProvider.track(event, safeProperties)).catch((error) => {
    debugAnalytics("failed", event, safeProperties, error);
  });
}

function createHttpAnalyticsProvider({
  endpoint,
  providerName,
  writeKey
}: {
  endpoint: string;
  providerName: string;
  writeKey: string;
}): AnalyticsProvider {
  return {
    async track(event, properties) {
      const response = await fetch(endpoint, {
        body: JSON.stringify({
          event,
          properties,
          sent_at: new Date().toISOString(),
          source: "mobile"
        }),
        headers: {
          Authorization: `Bearer ${writeKey}`,
          "Content-Type": "application/json",
          "X-Analytics-Provider": providerName
        },
        method: "POST"
      });

      if (!response.ok) {
        throw new Error(`Analytics request failed with status ${response.status}.`);
      }

      debugAnalytics("sent", event, properties);
    }
  };
}

function sanitizeAnalyticsProperties(
  properties: AnalyticsEventProperties
): AnalyticsEventProperties {
  const safeProperties: AnalyticsEventProperties = {};

  if (properties.language === "en" || properties.language === "fr") {
    safeProperties.language = properties.language;
  }

  if (properties.topic) {
    safeProperties.topic = properties.topic;
  }

  if (properties.content_type) {
    safeProperties.content_type = properties.content_type;
  }

  if (properties.drop_date) {
    safeProperties.drop_date = properties.drop_date;
  }

  if (properties.item_id) {
    safeProperties.item_id = properties.item_id;
  }

  return safeProperties;
}

function debugAnalytics(
  status: "failed" | "noop" | "sent",
  event: AnalyticsEventName,
  properties: AnalyticsEventProperties,
  error?: unknown
) {
  if (!__DEV__ || !analyticsDebugEnabled) {
    return;
  }

  console.info("[Analytics]", {
    event,
    hasProvider: Boolean(analyticsProvider),
    properties,
    status,
    error: error instanceof Error ? error.message : undefined
  });
}
