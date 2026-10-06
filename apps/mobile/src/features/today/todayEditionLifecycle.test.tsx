// react / react-dom resolve to apps/mobile/node_modules (React 19) because this
// file lives under apps/mobile, the same copy the provider itself uses.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDeviceTimeZone, getUserLocalDateKey, registerDeviceTimeZoneReader } from "../../lib/localDate";
import type { TodayDailyDrop } from "./contentTypes";

/**
 * Today across an edition's life, rendered for real: the DailyDropProvider and
 * the notification bridge against a stand-in backend that answers
 * `current_edition_date()` and serves one drop per edition date.
 *
 * The product rules under test:
 *   - Today is the OPEN edition (the backend's), not the reader's calendar day;
 *   - a notification opens the edition it names, cold or warm;
 *   - returning to the app picks up a publication without request storms.
 *
 * Paris is UTC+2 throughout (September). Mon 2026-09-07, Tue 08, Wed 09.
 */

vi.stubGlobal("__DEV__", false);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const MONDAY = "2026-09-07";
const TUESDAY = "2026-09-08";
const WEDNESDAY = "2026-09-09";
const FRIDAY_BEFORE = "2026-09-04";

let appStateListener: ((state: string) => void) | null = null;
let currentEdition: string | null = null;
let currentEditionError: { code: string; message: string } | null = null;
const drops = new Map<string, TodayDailyDrop>();
const fetchTodayDrop = vi.fn();
const pushSpy = vi.fn();
let coldStartResponse: unknown = null;
let notificationListener: ((response: unknown) => void) | null = null;

function edition(date: string, title = `Lead ${date}`): TodayDailyDrop {
  return {
    id: `drop-${date}`,
    drop_date: date,
    hide_display_date: false,
    language: "en",
    title: `Edition ${date}`,
    prompt_version: "test",
    generator_version: "test",
    estimated_read_minutes: 5,
    items: {
      newsletter: [{ id: `article-${date}`, title, content_type: "newsletter_article" } as never],
      business_story: undefined,
      mini_cases: [],
      mini_case: undefined,
      concept: undefined
    }
  };
}

function noEdition(date: string): TodayDailyDrop {
  return { ...edition(date), id: `no-edition:${date}`, items: { newsletter: [], business_story: undefined, mini_cases: [], mini_case: undefined, concept: undefined } };
}

vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove: () => (appStateListener = null) };
    }
  }
}));

vi.mock("../auth", () => ({
  useAuth: () => ({ profileLanguage: "en", status: "ready", user: { id: "reader-1" } })
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: (name: string) =>
      name === "current_edition_date"
        ? Promise.resolve({ data: currentEdition, error: currentEditionError })
        : Promise.resolve({ data: null, error: null })
  },
  getAuthSession: () => Promise.resolve({ data: { user: { id: "reader-1" } }, error: null }),
  normalizeSupabaseError: (error: { code?: string; message?: string } | null) => ({
    code: error?.code,
    message: error?.message ?? "error"
  })
}));

vi.mock("./dailyDropData", () => ({
  fetchTodayDrop: (...args: unknown[]) => fetchTodayDrop(...args),
  getFallbackTodayDrop: (_language: string, date: string) => noEdition(date)
}));

vi.mock("./contentInteractions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./contentInteractions")>();
  return {
    ...actual,
    readContentInteractionSnapshot: () =>
      Promise.resolve({ ok: true, snapshot: actual.createEmptyContentInteractionSnapshot() })
  };
});

vi.mock("../../lib/analytics", () => ({ trackAnalyticsEvent: () => undefined }));

vi.mock("expo-router", () => ({ useRouter: () => ({ push: pushSpy }) }));

vi.mock("expo-notifications", () => ({
  getLastNotificationResponseAsync: () => Promise.resolve(coldStartResponse),
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
    notificationListener = listener;
    return { remove: () => (notificationListener = null) };
  }
}));

const { DailyDropProvider, useDailyDrop } = await import("./DailyDropContext");
const { NotificationRoutingBridge } = await import("../notifications/NotificationRoutingBridge");
const { decideForegroundReload, parseEditionDateParam } = await import("./currentEdition");
const { resolveReaderEditionDate } = await import("./editionCadence");

type TodayValue = ReturnType<typeof useDailyDrop>;
let today: TodayValue;
let statuses: string[] = [];
let root: Root | null = null;

function Probe() {
  today = useDailyDrop();
  statuses.push(today.status);
  return null;
}

function notification(type: string, dropDate?: string) {
  return { notification: { request: { content: { data: { type, drop_date: dropDate } } } } };
}

async function settle() {
  for (let index = 0; index < 15; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount({ withNotifications = false } = {}) {
  const container = document.createElement("div");
  root = createRoot(container);

  await act(async () => {
    root!.render(
      <DailyDropProvider>
        {withNotifications ? <NotificationRoutingBridge /> : null}
        <Probe />
      </DailyDropProvider>
    );
  });
  await settle();
}

async function foreground() {
  await act(async () => {
    appStateListener?.("active");
  });
  await settle();
}

function at(iso: string) {
  vi.setSystemTime(new Date(iso));
}

function requestedDates(): string[] {
  return fetchTodayDrop.mock.calls.map((call) => call[1] as string);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  registerDeviceTimeZoneReader(() => "Europe/Paris");
  appStateListener = null;
  notificationListener = null;
  coldStartResponse = null;
  currentEdition = null;
  currentEditionError = null;
  drops.clear();
  statuses = [];
  pushSpy.mockReset();
  fetchTodayDrop.mockReset();
  fetchTodayDrop.mockImplementation(async (_userId: string, date: string) => ({
    data: drops.get(date) ?? noEdition(date),
    error: null,
    fallbackReason: null,
    source: "supabase"
  }));
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  vi.useRealTimers();
});

describe("Today is the open edition", () => {
  it("G. Monday's edition is still Today after the reader's midnight, until the next one publishes", async () => {
    at("2026-09-07T22:30:00Z"); // Tue 00:30 in Paris
    currentEdition = MONDAY;
    drops.set(MONDAY, edition(MONDAY));

    await mount();

    // The old calendar rule would have asked for Tuesday, a quiet day.
    expect(resolveReaderEditionDate()).toBe(TUESDAY);
    expect(today.drop.drop_date).toBe(MONDAY);
    expect(today.isEmptyDrop).toBe(false);
    expect(today.currentEditionDate).toBe(MONDAY);
    expect(today.pinnedEditionDate).toBeNull();
  });

  it("falls back to the reader-day rule when the backend cannot name an edition", async () => {
    at("2026-09-09T10:00:00Z");
    currentEditionError = { code: "PGRST202", message: "function not found" };
    drops.set(WEDNESDAY, edition(WEDNESDAY));

    await mount();

    expect(today.drop.drop_date).toBe(WEDNESDAY);
    expect(today.currentEditionDate).toBeNull();
  });
});

describe("returning to the app", () => {
  it("A + H. opened before publication; the edition published meanwhile appears on foreground", async () => {
    at("2026-09-09T16:30:00Z"); // Wed 18:30 Paris
    currentEdition = MONDAY;
    drops.set(MONDAY, edition(MONDAY));

    await mount();
    expect(today.drop.drop_date).toBe(MONDAY);

    // 19:00 Paris: Wednesday publishes while the app is in the background.
    currentEdition = WEDNESDAY;
    drops.set(WEDNESDAY, edition(WEDNESDAY));
    at("2026-09-09T17:05:00Z");
    statuses = [];

    await foreground();

    expect(today.drop.drop_date).toBe(WEDNESDAY);
    expect(today.currentEditionDate).toBe(WEDNESDAY);
    // Quiet: the reader never saw the loader for a routine re-check.
    expect(statuses).not.toContain("loading");
  });

  it("B. an upcoming Today re-reads on a same-day foreground", async () => {
    at("2026-09-09T16:30:00Z");
    currentEdition = null; // nothing published yet for this reader's backend

    await mount();
    expect(today.isEmptyDrop).toBe(true);
    expect(today.drop.drop_date).toBe(WEDNESDAY);
    fetchTodayDrop.mockClear();

    at("2026-09-09T16:30:20Z"); // 20 s later, same calendar day
    currentEdition = WEDNESDAY;
    drops.set(WEDNESDAY, edition(WEDNESDAY));

    await foreground();

    expect(requestedDates()).toEqual([WEDNESDAY]);
    expect(today.isEmptyDrop).toBe(false);
  });

  it("B. but not more often than the floor while it is still upcoming", async () => {
    at("2026-09-09T16:30:00Z");
    await mount();
    fetchTodayDrop.mockClear();

    at("2026-09-09T16:30:05Z");
    await foreground();
    await foreground();

    expect(fetchTodayDrop).not.toHaveBeenCalled();
  });

  it("C. a fresh published edition is not re-read on immediate foregrounds", async () => {
    at("2026-09-09T17:10:00Z");
    currentEdition = WEDNESDAY;
    drops.set(WEDNESDAY, edition(WEDNESDAY));

    await mount();
    fetchTodayDrop.mockClear();

    for (const seconds of ["05", "10", "30", "55"]) {
      at(`2026-09-09T17:10:${seconds}Z`);
      await foreground();
    }

    expect(fetchTodayDrop).not.toHaveBeenCalled();

    // Once older than the content cache's TTL, one re-read.
    at("2026-09-09T17:11:05Z");
    await foreground();
    expect(fetchTodayDrop).toHaveBeenCalledTimes(1);
  });

  it("I. a timezone change on the device is a new edition key, and reloads at once", async () => {
    at("2026-09-07T22:30:00Z"); // Tue 00:30 Paris, Mon 17:30 Chicago
    currentEdition = MONDAY;
    drops.set(MONDAY, edition(MONDAY));

    await mount();
    fetchTodayDrop.mockClear();

    expect(getUserLocalDateKey()).toBe(TUESDAY);
    registerDeviceTimeZoneReader(() => "America/Chicago");
    expect(getDeviceTimeZone()).toBe("America/Chicago");
    expect(getUserLocalDateKey()).toBe(MONDAY);

    at("2026-09-07T22:30:05Z"); // well inside the TTL
    await foreground();

    expect(fetchTodayDrop).toHaveBeenCalledTimes(1);
  });
});

describe("notifications open the edition they name", () => {
  it("D. Tuesday's morning reminder about Monday opens Monday", async () => {
    at("2026-09-08T06:30:00Z"); // Tue 08:30 Paris
    currentEdition = MONDAY;
    drops.set(MONDAY, edition(MONDAY));

    await mount({ withNotifications: true });
    fetchTodayDrop.mockClear();

    await act(async () => {
      notificationListener?.(notification("edition_answer_reminder", MONDAY));
    });
    await settle();

    expect(pushSpy).toHaveBeenCalledWith({
      pathname: "/(tabs)/newsletter",
      params: { drop_date: MONDAY }
    });
    expect(requestedDates()).toEqual([MONDAY]);
    expect(today.drop.drop_date).toBe(MONDAY);
    // Monday is the open edition: this is Today, not a pinned old one.
    expect(today.pinnedEditionDate).toBeNull();
  });

  it("E. a cold start from a notification opens the edition it names", async () => {
    at("2026-09-08T06:30:00Z");
    currentEdition = MONDAY;
    drops.set(MONDAY, edition(MONDAY));
    drops.set(FRIDAY_BEFORE, edition(FRIDAY_BEFORE));
    coldStartResponse = notification("edition_answer_reminder", FRIDAY_BEFORE);

    await mount({ withNotifications: true });

    expect(pushSpy).toHaveBeenCalledWith({
      pathname: "/(tabs)/newsletter",
      params: { drop_date: FRIDAY_BEFORE }
    });
    expect(today.drop.drop_date).toBe(FRIDAY_BEFORE);
    expect(today.pinnedEditionDate).toBe(FRIDAY_BEFORE);
  });

  it("F. a warm tap opens a still-present older edition, and the reader can return to Today", async () => {
    at("2026-09-08T06:30:00Z");
    currentEdition = MONDAY;
    drops.set(MONDAY, edition(MONDAY));
    drops.set(FRIDAY_BEFORE, edition(FRIDAY_BEFORE));

    await mount({ withNotifications: true });
    expect(today.drop.drop_date).toBe(MONDAY);

    await act(async () => {
      notificationListener?.(notification("edition_ready", FRIDAY_BEFORE));
    });
    await settle();

    expect(today.drop.drop_date).toBe(FRIDAY_BEFORE);
    expect(today.pinnedEditionDate).toBe(FRIDAY_BEFORE);

    // A pinned edition survives a routine foreground…
    at("2026-09-08T06:45:00Z");
    await foreground();
    expect(today.drop.drop_date).toBe(FRIDAY_BEFORE);

    // …and the reader can go back to the open one.
    await act(async () => {
      await today.showCurrentEdition();
    });
    await settle();
    expect(today.drop.drop_date).toBe(MONDAY);
    expect(today.pinnedEditionDate).toBeNull();
  });

  it("4. an 'edition is here' tap reloads past a stale 'on its way'", async () => {
    at("2026-09-09T16:30:00Z");
    currentEdition = MONDAY;
    drops.set(MONDAY, edition(MONDAY));

    await mount({ withNotifications: true });

    currentEdition = WEDNESDAY;
    drops.set(WEDNESDAY, edition(WEDNESDAY));
    at("2026-09-09T18:00:05Z");

    await act(async () => {
      notificationListener?.(notification("edition_ready", WEDNESDAY));
    });
    await settle();

    expect(today.drop.drop_date).toBe(WEDNESDAY);
  });

  it("J. a target that no longer exists falls back to the open edition", async () => {
    at("2026-09-08T06:30:00Z");
    currentEdition = MONDAY;
    drops.set(MONDAY, edition(MONDAY));

    await mount({ withNotifications: true });

    await act(async () => {
      notificationListener?.(notification("edition_ready", "2026-01-05"));
    });
    await settle();

    expect(today.drop.drop_date).toBe(MONDAY);
    expect(today.isEmptyDrop).toBe(false);
    expect(today.pinnedEditionDate).toBeNull();
  });

  it("J. a malformed drop_date is ignored and the open edition is reloaded", async () => {
    at("2026-09-08T06:30:00Z");
    currentEdition = MONDAY;
    drops.set(MONDAY, edition(MONDAY));

    await mount({ withNotifications: true });
    fetchTodayDrop.mockClear();

    await act(async () => {
      notificationListener?.(notification("edition_ready", "2026-02-30T00:00"));
    });
    await settle();

    expect(pushSpy).toHaveBeenCalledWith({ pathname: "/(tabs)/newsletter", params: {} });
    expect(requestedDates()).toEqual([MONDAY]);
    expect(today.drop.drop_date).toBe(MONDAY);
  });
});

describe("pure rules", () => {
  it("parses only real calendar dates", () => {
    expect(parseEditionDateParam(MONDAY)).toBe(MONDAY);
    expect(parseEditionDateParam([MONDAY])).toBe(MONDAY);
    expect(parseEditionDateParam("2026-02-30")).toBeNull();
    expect(parseEditionDateParam("Monday")).toBeNull();
    expect(parseEditionDateParam(undefined)).toBeNull();
  });

  it("never reloads while a load is running", () => {
    expect(
      decideForegroundReload({
        now: 1_000_000,
        lastLoadedAt: 0,
        loading: true,
        ttlMs: 60_000,
        minIntervalMs: 15_000,
        editionKeyChanged: true,
        awaitingPublication: true,
        pinned: false
      })
    ).toBe(false);
  });
});
