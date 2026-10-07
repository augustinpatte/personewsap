// react / react-dom resolve to apps/mobile/node_modules (React 19) because this
// file lives under apps/mobile, the same copy the provider itself uses.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getUserLocalDateKey, registerDeviceTimeZoneReader } from "../../lib/localDate";
import type { TodayDailyDrop } from "./contentTypes";

/**
 * Two promises the Today surface makes, rendered for real against a stand-in
 * backend (the same harness as todayEditionLifecycle.test.tsx):
 *
 *   1. "Today" means the reader's own calendar day. The newest edition in the
 *      database — what `current_edition_date()` returns — is available, but it
 *      is not "today's" unless it is dated today.
 *
 *   2. Content that is on screen stays on screen. Only an empty screen gets a
 *      loader; a background re-check never shows one, and a failed re-check
 *      never blanks a usable edition.
 */

vi.stubGlobal("__DEV__", false);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const SEPT_18 = "2026-09-18";
const OCT_5 = "2026-10-05";
const OCT_6 = "2026-10-06";
const OCT_7 = "2026-10-07";

let appStateListener: ((state: string) => void) | null = null;
let currentEdition: string | null = null;
let currentEditionError: { code: string; message: string } | null = null;
const drops = new Map<string, TodayDailyDrop>();
const fetchTodayDrop = vi.fn();
let notificationListener: ((response: unknown) => void) | null = null;

function edition(date: string): TodayDailyDrop {
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
      newsletter: [{ id: `article-${date}`, title: `Lead ${date}`, content_type: "newsletter_article" } as never],
      business_story: undefined,
      mini_cases: [],
      mini_case: undefined,
      concept: undefined
    }
  };
}

function noEdition(date: string): TodayDailyDrop {
  return {
    ...edition(date),
    id: `no-edition:${date}`,
    items: { newsletter: [], business_story: undefined, mini_cases: [], mini_case: undefined, concept: undefined }
  };
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

vi.mock("expo-router", () => ({ useRouter: () => ({ push: () => undefined }) }));

vi.mock("expo-notifications", () => ({
  getLastNotificationResponseAsync: () => Promise.resolve(null),
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
    notificationListener = listener;
    return { remove: () => (notificationListener = null) };
  }
}));

const { DailyDropProvider, useDailyDrop } = await import("./DailyDropContext");
const { useEditionRecency } = await import("./useEditionRecency");
const { NotificationRoutingBridge } = await import("../notifications/NotificationRoutingBridge");
const { isTodayEdition, resolveEditionRecency } = await import("./editionRecency");
const { resolveTodayEditionState } = await import("./todayEditionState");
const { hasVisibleEdition, shouldKeepVisibleEdition, showsPullSpinner, statusAtLoadStart } =
  await import("./editionLoadPolicy");
const { editionViewLabel, getModuleCopy } = await import("../modules/moduleCopy");

type TodayValue = ReturnType<typeof useDailyDrop>;
let today: TodayValue;
let recency: string;
/** Every render after the first edition was on screen. */
let renders: Array<{ status: string; items: number; refreshing: boolean; date: string }> = [];
let root: Root | null = null;

function Probe() {
  today = useDailyDrop();
  recency = useEditionRecency();
  renders.push({
    status: today.status,
    items: today.totalItemCount,
    refreshing: today.refreshing,
    date: today.drop.drop_date
  });
  return null;
}

/** What a module screen would render right now. */
function screenState() {
  return resolveTodayEditionState({
    dropDate: today.drop.drop_date,
    error: today.error,
    isEmptyDrop: today.isEmptyDrop,
    status: today.status,
    readerToday: getUserLocalDateKey()
  });
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

/** Hold the next drop fetch open until `release()` is called. */
function holdNextFetch() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  fetchTodayDrop.mockImplementationOnce(async (_userId: string, date: string) => {
    await gate;
    return { data: drops.get(date) ?? noEdition(date), error: null, fallbackReason: null, source: "supabase" };
  });

  return async () => {
    release();
    await settle();
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  registerDeviceTimeZoneReader(() => "Europe/Paris");
  appStateListener = null;
  notificationListener = null;
  currentEdition = null;
  currentEditionError = null;
  drops.clear();
  renders = [];
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

// ---------------------------------------------------------------------------
// 1. TODAY MEANS THE READER'S DAY
// ---------------------------------------------------------------------------

describe("the canonical rule", () => {
  it("the reader's exact local date is Today", () => {
    expect(isTodayEdition(OCT_6, OCT_6)).toBe(true);
    expect(resolveEditionRecency({ editionDate: OCT_6, pinnedEditionDate: null, readerToday: OCT_6 })).toBe("today");
  });

  it("yesterday is not Today", () => {
    expect(isTodayEdition(OCT_5, OCT_6)).toBe(false);
    expect(resolveEditionRecency({ editionDate: OCT_5, pinnedEditionDate: null, readerToday: OCT_6 })).toBe("latest");
  });

  it("September 18, returned as the newest edition in October, is not Today", () => {
    expect(isTodayEdition(SEPT_18, OCT_6)).toBe(false);
    expect(resolveEditionRecency({ editionDate: SEPT_18, pinnedEditionDate: null, readerToday: OCT_6 })).toBe("latest");
  });

  it("an edition opened explicitly is a past edition, unless it is dated today", () => {
    expect(resolveEditionRecency({ editionDate: SEPT_18, pinnedEditionDate: SEPT_18, readerToday: OCT_6 })).toBe("past");
    // Pinning says how the reader arrived, not what day it is.
    expect(resolveEditionRecency({ editionDate: OCT_6, pinnedEditionDate: OCT_6, readerToday: OCT_6 })).toBe("today");
  });

  it("rejects anything that is not a calendar date", () => {
    expect(isTodayEdition(null, OCT_6)).toBe(false);
    expect(isTodayEdition("2026-10-06T00:00:00Z", OCT_6)).toBe(false);
  });

  it("follows the reader's zone at a midnight boundary, never Paris", () => {
    at("2026-10-06T22:30:00Z"); // 00:30 Oct 7 in Paris, 17:30 Oct 6 in Chicago

    registerDeviceTimeZoneReader(() => "Europe/Paris");
    expect(isTodayEdition(OCT_6)).toBe(false);
    expect(isTodayEdition(OCT_7)).toBe(true);

    registerDeviceTimeZoneReader(() => "America/Chicago");
    expect(isTodayEdition(OCT_6)).toBe(true);
    expect(isTodayEdition(OCT_7)).toBe(false);
  });

  it("is never cached: the same edition stops being Today at the reader's midnight", () => {
    registerDeviceTimeZoneReader(() => "Europe/Paris");
    at("2026-10-06T21:59:00Z"); // 23:59 Paris
    expect(resolveEditionRecency({ editionDate: OCT_6, pinnedEditionDate: null })).toBe("today");
    at("2026-10-06T22:01:00Z"); // 00:01 Paris
    expect(resolveEditionRecency({ editionDate: OCT_6, pinnedEditionDate: null })).toBe("latest");
  });
});

describe("Today, rendered against the backend", () => {
  it("the backend's open edition from September is available but labelled Latest, not Today", async () => {
    at("2026-10-06T08:00:00Z");
    currentEdition = SEPT_18;
    drops.set(SEPT_18, edition(SEPT_18));

    await mount();

    expect(today.drop.drop_date).toBe(SEPT_18);
    expect(today.isEmptyDrop).toBe(false);
    expect(recency).toBe("latest");
    expect(editionViewLabel(getModuleCopy("en"), recency as never)).toBe("Latest");
    expect(editionViewLabel(getModuleCopy("fr"), recency as never)).toBe("Dernière");
  });

  it("the edition dated today is Today", async () => {
    at("2026-10-06T18:00:00Z");
    currentEdition = OCT_6;
    drops.set(OCT_6, edition(OCT_6));

    await mount();

    expect(recency).toBe("today");
    expect(editionViewLabel(getModuleCopy("en"), recency as never)).toBe("Today");
    expect(editionViewLabel(getModuleCopy("fr"), recency as never)).toBe("Aujourd'hui");
  });

  it("a notification opening a historical edition does not turn it into Today, nor move the open edition", async () => {
    at("2026-10-06T08:00:00Z");
    currentEdition = OCT_5;
    drops.set(OCT_5, edition(OCT_5));
    drops.set(SEPT_18, edition(SEPT_18));

    await mount({ withNotifications: true });
    expect(recency).toBe("latest");

    await act(async () => {
      notificationListener?.({
        notification: { request: { content: { data: { type: "edition_answer_reminder", drop_date: SEPT_18 } } } }
      });
    });
    await settle();

    expect(today.drop.drop_date).toBe(SEPT_18);
    expect(today.pinnedEditionDate).toBe(SEPT_18);
    expect(recency).toBe("past");
    // The global notion of the open edition is untouched.
    expect(today.currentEditionDate).toBe(OCT_5);

    await act(async () => {
      await today.showCurrentEdition();
    });
    await settle();

    expect(today.drop.drop_date).toBe(OCT_5);
    expect(today.pinnedEditionDate).toBeNull();
    expect(recency).toBe("latest");
  });

  it("a notification for today's edition is Today", async () => {
    at("2026-10-06T18:30:00Z");
    currentEdition = OCT_6;
    drops.set(OCT_6, edition(OCT_6));

    await mount({ withNotifications: true });

    await act(async () => {
      notificationListener?.({
        notification: { request: { content: { data: { type: "edition_ready", drop_date: OCT_6 } } } }
      });
    });
    await settle();

    expect(recency).toBe("today");
  });

  it("an empty answer for an old date never claims today's edition is on the way on a quiet day", () => {
    // Tuesday Oct 6 is not a publication day; the empty drop is Monday's.
    expect(
      resolveTodayEditionState({ dropDate: OCT_5, error: null, isEmptyDrop: true, status: "ready", readerToday: OCT_6 })
    ).toBe("quiet");
    // Wednesday is: the edition is genuinely on its way.
    expect(
      resolveTodayEditionState({ dropDate: OCT_5, error: null, isEmptyDrop: true, status: "ready", readerToday: OCT_7 })
    ).toBe("upcoming");
  });
});

describe("Newsletter, Business Stories and Mini Cases agree", () => {
  const modulesDir = join(__dirname, "..", "modules");
  const screens = ["NewsletterModuleScreen.tsx", "StoriesModuleScreen.tsx", "MiniCasesModuleScreen.tsx"];

  for (const file of screens) {
    it(`${file} labels its edition through the one recency rule`, () => {
      const source = readFileSync(join(modulesDir, file), "utf8");

      expect(source).toContain("useEditionRecency()");
      expect(source).toContain("leftLabel={editionViewLabel(copy, recency)}");
      expect(source).not.toContain("leftLabel={copy.common.todayView}");
      expect(source).toContain("readerToday: getUserLocalDateKey()");
    });
  }

  it("the edition progress line only says 'today' for today's edition", async () => {
    const { resolveEditionProgress } = await import("../modules/editionProgress");
    const past = resolveEditionProgress({
      completedItemCount: 1,
      totalItemCount: 3,
      isLiveEdition: true,
      status: "ready",
      isTodayEdition: false
    });

    expect(past).toMatchObject({ kind: "inProgress", today: false });
    expect(getModuleCopy("en").common.editionProgressPast(1, 3)).toBe("1 of 3 completed");
    expect(getModuleCopy("fr").common.editionProgressPast(2, 3)).toBe("2 sur 3 terminés");
    expect(getModuleCopy("en").newsletter.noModuleToday).not.toMatch(/today/i);
    expect(getModuleCopy("fr").cases.noModuleToday).not.toMatch(/jour/i);
  });
});

// ---------------------------------------------------------------------------
// 2. CONTENT ON SCREEN STAYS ON SCREEN
// ---------------------------------------------------------------------------

describe("the loading rules", () => {
  it("no content + loading → loader", () => {
    expect(statusAtLoadStart({ quiet: false, visible: false, current: "loading" })).toBe("loading");
    expect(statusAtLoadStart({ quiet: false, visible: false, current: "ready" })).toBe("loading");
  });

  it("content on screen is never put back behind a loader", () => {
    expect(statusAtLoadStart({ quiet: false, visible: true, current: "ready" })).toBe("ready");
    expect(statusAtLoadStart({ quiet: true, visible: true, current: "ready" })).toBe("ready");
  });

  it("only a pull shows the pull spinner", () => {
    expect(showsPullSpinner("pull")).toBe(true);
    expect(showsPullSpinner("system")).toBe(false);
    expect(showsPullSpinner(undefined)).toBe(false);
  });

  it("an edition loaded for another account is never 'on screen' for this one", () => {
    expect(hasVisibleEdition({ status: "ready", itemCount: 3, ownerId: "a" }, "a")).toBe(true);
    expect(hasVisibleEdition({ status: "ready", itemCount: 3, ownerId: "a" }, "b")).toBe(false);
    expect(hasVisibleEdition({ status: "ready", itemCount: 0, ownerId: "a" }, "a")).toBe(false);
  });

  it("keeps the visible edition only when an empty result is untrustworthy", () => {
    const base = {
      visible: true,
      resultItemCount: 0,
      currentEditionLookupFailed: true,
      fetchFailed: false,
      explicitEditionRequest: false
    };

    expect(shouldKeepVisibleEdition(base)).toBe(true);
    expect(shouldKeepVisibleEdition({ ...base, currentEditionLookupFailed: false })).toBe(false);
    expect(shouldKeepVisibleEdition({ ...base, resultItemCount: 2 })).toBe(false);
    expect(shouldKeepVisibleEdition({ ...base, explicitEditionRequest: true })).toBe(false);
    expect(shouldKeepVisibleEdition({ ...base, visible: false })).toBe(false);
  });
});

describe("loading, rendered", () => {
  it("the first load, with nothing to show, renders the loader", async () => {
    at("2026-10-06T08:00:00Z");
    currentEdition = OCT_5;
    drops.set(OCT_5, edition(OCT_5));
    const release = holdNextFetch();

    await mount();

    expect(today.status).toBe("loading");
    expect(screenState()).toBe("loading");

    await release();

    expect(screenState()).toBe("edition");
  });

  it("a background re-check keeps the edition visible, with no loader and no spinner", async () => {
    at("2026-10-06T08:00:00Z");
    currentEdition = OCT_5;
    drops.set(OCT_5, edition(OCT_5));

    await mount();
    expect(screenState()).toBe("edition");

    // A new day: the foreground policy must re-read Today.
    at("2026-10-07T08:00:00Z");
    const release = holdNextFetch();
    renders = [];

    await foreground();

    expect(fetchTodayDrop).toHaveBeenCalledTimes(2);
    expect(screenState()).toBe("edition");
    expect(today.refreshing).toBe(false);
    expect(renders.every((render) => render.status === "ready" && render.items > 0 && !render.refreshing)).toBe(true);

    await release();
    expect(screenState()).not.toBe("loading");
  });

  it("a pull keeps the content and shows the pull spinner only while it runs", async () => {
    at("2026-10-06T08:00:00Z");
    currentEdition = OCT_5;
    drops.set(OCT_5, edition(OCT_5));

    await mount();
    const release = holdNextFetch();
    let pull: Promise<void> = Promise.resolve();

    await act(async () => {
      pull = today.refresh();
    });
    await settle();

    expect(today.refreshing).toBe(true);
    expect(screenState()).toBe("edition");

    await release();
    await act(async () => {
      await pull;
    });

    expect(today.refreshing).toBe(false);
    expect(screenState()).toBe("edition");
  });

  it("opening a historical edition while the open one resolves never shows a phantom loader", async () => {
    at("2026-10-06T08:00:00Z");
    currentEdition = OCT_5;
    drops.set(OCT_5, edition(OCT_5));
    drops.set(SEPT_18, edition(SEPT_18));

    await mount();
    const release = holdNextFetch();
    renders = [];

    let opening: Promise<void> = Promise.resolve();
    await act(async () => {
      opening = today.openEdition(SEPT_18);
    });
    await settle();

    // Still the edition the reader had, readable, while the other one loads.
    expect(today.status).toBe("ready");
    expect(screenState()).toBe("edition");

    await release();
    await act(async () => {
      await opening;
    });

    expect(today.drop.drop_date).toBe(SEPT_18);
    expect(renders.some((render) => render.status === "loading")).toBe(false);
    expect(renders.some((render) => render.items === 0)).toBe(false);
  });

  it("a failed current-edition lookup with valid content leaves the content usable", async () => {
    at("2026-10-06T08:00:00Z");
    currentEdition = OCT_5;
    drops.set(OCT_5, edition(OCT_5));

    await mount();
    expect(today.drop.drop_date).toBe(OCT_5);

    // The next day, the lookup fails: the fallback asks for the reader's own
    // date, where nothing exists. The edition on screen must survive that.
    at("2026-10-07T08:00:00Z");
    currentEditionError = { code: "500", message: "unavailable" };
    renders = [];

    await foreground();

    expect(today.drop.drop_date).toBe(OCT_5);
    expect(today.isEmptyDrop).toBe(false);
    expect(screenState()).toBe("edition");
    expect(renders.every((render) => render.items > 0)).toBe(true);
  });

  it("a successful re-check that finds nothing new still shows the truth", async () => {
    // The control for the rule above: when the lookup works, its answer wins.
    at("2026-10-06T08:00:00Z");
    currentEdition = OCT_5;
    drops.set(OCT_5, edition(OCT_5));
    await mount();

    at("2026-10-07T18:30:00Z");
    currentEdition = OCT_7;
    drops.set(OCT_7, edition(OCT_7));
    await foreground();

    expect(today.drop.drop_date).toBe(OCT_7);
    expect(recency).toBe("today");
  });
});
