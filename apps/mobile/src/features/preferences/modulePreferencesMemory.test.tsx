// react / react-dom resolve to apps/mobile/node_modules (React 19) because this
// file lives under apps/mobile, the same copy the hooks themselves use.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCachedValue, setCachedValue } from "../../lib/memoryCache";
import type { ModuleFlags } from "./moduleFlags";

/**
 * Module tabs read their switch from memory, and a preference save refreshes
 * only what it changed.
 *
 * Before: every focus of the Newsletter, Stories and Mini cases tabs re-read
 * four preference tables, and every save cleared and reloaded Today, the
 * Archive and every opened reading whatever had changed.
 */

vi.stubGlobal("__DEV__", false);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const tableReads: string[] = [];

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      tableReads.push(table);
      throw new Error(`unexpected read of ${table}`);
    }
  },
  normalizeSupabaseError: (error: unknown) => error
}));

const ALL_ON: ModuleFlags = { newsletter: true, business_story: true, mini_case: true, learning_path: false };

let auth: { status: string; user: { id: string } | null; moduleFlags: ModuleFlags | null };

vi.mock("../auth", () => ({ useAuth: () => auth }));

const { useModulePreferenceState } = await import("./useModulePreferenceState");
const { planPreferenceSaveRefresh, clearPreferenceSensitiveContentCache } = await import("./contentRefresh");

let root: Root | null = null;
let seen: Array<{ enabled: boolean; status: string }> = [];

function Tab({ moduleId }: { moduleId: "newsletter" | "business_story" | "mini_case" }) {
  seen.push(useModulePreferenceState(moduleId));
  return null;
}

async function render(moduleId: "newsletter" | "business_story" | "mini_case") {
  await act(async () => {
    root!.render(<Tab moduleId={moduleId} />);
  });
}

beforeEach(() => {
  tableReads.length = 0;
  seen = [];
  auth = { status: "ready", user: { id: "reader-a" }, moduleFlags: ALL_ON };
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
});

describe("tab focus reads memory, not Supabase", () => {
  it("switching Newsletter → Stories → Mini cases, twice, makes no request", async () => {
    for (const moduleId of ["newsletter", "business_story", "mini_case", "newsletter", "business_story", "mini_case"] as const) {
      await render(moduleId);
    }

    expect(tableReads).toEqual([]);
    expect(seen.at(-1)).toEqual({ enabled: true, status: "ready" });
  });

  it("a saved switch shows on the next render, with no request", async () => {
    await render("mini_case");
    auth = { ...auth, moduleFlags: { ...ALL_ON, mini_case: false } };
    await render("mini_case");

    expect(seen.at(-1)).toEqual({ enabled: false, status: "ready" });
    expect(tableReads).toEqual([]);
  });

  it("before the flags of this reader are known it waits; signed out it is idle", async () => {
    auth = { ...auth, moduleFlags: null };
    await render("newsletter");
    expect(seen.at(-1)).toEqual({ enabled: true, status: "loading" });

    auth = { status: "signedOut", user: null, moduleFlags: null };
    await render("newsletter");
    expect(seen.at(-1)).toEqual({ enabled: true, status: "idle" });
  });
});

describe("a preference save refreshes what it changed, and no more", () => {
  it("topics or article counts only: nothing is re-read (they shape the next edition)", () => {
    expect(planPreferenceSaveRefresh(ALL_ON, ALL_ON)).toEqual({
      moduleFlags: ALL_ON,
      reloadEditionContent: false,
      learningChanged: false
    });
  });

  it("a content module switched: Today and the Archive lists are re-read", () => {
    const plan = planPreferenceSaveRefresh(ALL_ON, { ...ALL_ON, business_story: false });
    expect(plan.reloadEditionContent).toBe(true);
    expect(plan.learningChanged).toBe(false);
  });

  it("the learning path switched: Learning only", () => {
    const plan = planPreferenceSaveRefresh(ALL_ON, { ...ALL_ON, learning_path: true });
    expect(plan).toMatchObject({ reloadEditionContent: false, learningChanged: true });
  });

  it("unknown before-state: everything, to be safe", () => {
    expect(planPreferenceSaveRefresh(null, ALL_ON)).toMatchObject({
      reloadEditionContent: true,
      learningChanged: true
    });
  });

  it("the edition invalidation clears the list caches, never opened readings", () => {
    for (const key of [
      "today-drop:reader-a:2026-10-05",
      "library-drops:reader-a:25:fr:head",
      "archive-search:reader-a:fr",
      "content-item:item-1:fr",
      "content-sources:item-1"
    ]) {
      setCachedValue(key, { cached: true }, 60_000);
    }

    clearPreferenceSensitiveContentCache();

    expect(getCachedValue("today-drop:reader-a:2026-10-05")).toBeNull();
    expect(getCachedValue("library-drops:reader-a:25:fr:head")).toBeNull();
    expect(getCachedValue("archive-search:reader-a:fr")).toBeNull();
    expect(getCachedValue("content-item:item-1:fr")).not.toBeNull();
    expect(getCachedValue("content-sources:item-1")).not.toBeNull();
  });
});
