// react / react-dom resolve to apps/mobile/node_modules (React 19), the copy
// the hook itself uses — same harness as liveTeamScore.test.tsx.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("__DEV__", false);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

/**
 * The Teams introduction: once per reader, remembered across devices, and
 * reopenable by hand without ever resetting.
 *
 * The server holds profiles.teams_intro_completed_at per reader; the device
 * keeps a copy per user id. Both are doubles here: `server` is what
 * complete_teams_intro() and the owner-only profile read see, `storage` is
 * AsyncStorage. `signedIn` is whose JWT the RPC carries.
 */

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: (key: string) => Promise.resolve(storage.get(key) ?? null),
    setItem: (key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    }
  }
}));

const server = new Map<string, string | null>();
const rpcCalls: string[] = [];
let signedIn: string | null = null;
let serverDown = false;
let rpcFails = false;

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_column: string, userId: string) => ({
          maybeSingle: () =>
            Promise.resolve(
              serverDown
                ? { data: null, error: { code: "PGRST000", message: "unreachable" } }
                : {
                    data: server.has(userId) ? { teams_intro_completed_at: server.get(userId) } : null,
                    error: null
                  }
            )
        })
      })
    }),
    rpc: (name: string) => {
      rpcCalls.push(name);

      if (rpcFails) {
        return Promise.resolve({ data: null, error: { code: "08006", message: "offline" } });
      }

      if (signedIn && !server.get(signedIn)) {
        server.set(signedIn, "2026-09-13T10:00:00Z");
      }

      return Promise.resolve({ data: signedIn ? server.get(signedIn) : null, error: null });
    }
  }
}));

import {
  clampIntroStep,
  isLastIntroStep,
  SCORING_STEP_INDEX,
  shouldShowTeamsIntro,
  TEAMS_INTRO_STEPS,
  teamsIntroReducer,
  teamsIntroStorageKey
} from "./teamsIntroRules";
import { getTeamsIntroCopy } from "./teamsIntroCopy";
import { getTeamsCopy } from "./teamsCopy";
import { useTeamsIntroGate } from "./useTeamsIntroGate";

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000002";
const CARA = "cccccccc-0000-4000-8000-000000000003";
const DEAN = "dddddddd-0000-4000-8000-000000000004";

type Gate = ReturnType<typeof useTeamsIntroGate>;

let root: Root | null = null;
const latest: { current: Gate | null } = { current: null };

function Probe({ userId }: { userId: string }) {
  latest.current = useTeamsIntroGate(userId);
  return null;
}

/** Opening the Teams tab as this reader. */
function open(userId: string) {
  signedIn = userId;
  root = createRoot(document.createElement("div"));
  act(() => {
    root?.render(<Probe userId={userId} />);
  });
}

function close() {
  act(() => root?.unmount());
  root = null;
  latest.current = null;
}

async function flush() {
  await act(async () => {
    for (let turn = 0; turn < 6; turn += 1) {
      await Promise.resolve();
    }
  });
}

function gate(): Gate {
  if (!latest.current) {
    throw new Error("hook not rendered");
  }
  return latest.current;
}

beforeEach(() => {
  storage.clear();
  server.clear();
  rpcCalls.length = 0;
  signedIn = null;
  serverDown = false;
  rpcFails = false;
});

afterEach(() => {
  if (root) {
    close();
  }
});

describe("first open", () => {
  it("opens Teams on the introduction, after a check that shows neither screen", async () => {
    server.set(ALICE, null);
    open(ALICE);

    expect(gate().status).toBe("checking");

    await flush();
    expect(gate().status).toBe("show");
  });

  it("finishing it lands on Teams and records it for the reader", async () => {
    server.set(ALICE, null);
    open(ALICE);
    await flush();

    await act(async () => gate().complete());
    await flush();

    expect(gate().status).toBe("hidden");
    expect(rpcCalls).toEqual(["complete_teams_intro"]);
    expect(server.get(ALICE)).toBeTruthy();
    expect(storage.has(teamsIntroStorageKey(ALICE))).toBe(true);
  });
});

describe("afterwards", () => {
  it("the second open goes straight to Teams, and writes nothing", async () => {
    server.set(ALICE, null);
    open(ALICE);
    await flush();
    await act(async () => gate().complete());
    close();

    open(ALICE);
    await flush();

    expect(gate().status).toBe("hidden");
    expect(rpcCalls).toEqual(["complete_teams_intro"]);
  });

  it("survives a restart on a new phone: the server remembers the reader", async () => {
    server.set(ALICE, "2026-09-12T08:00:00Z");
    open(ALICE);
    await flush();

    expect(gate().status).toBe("hidden");
    // And the device keeps a copy from now on.
    expect(storage.has(teamsIntroStorageKey(ALICE))).toBe(true);
  });

  it("another reader on the same phone gets their own introduction", async () => {
    server.set(ALICE, "2026-09-12T08:00:00Z");
    server.set(BOB, null);
    storage.set(teamsIntroStorageKey(ALICE), "2026-09-12T08:00:00Z");

    open(BOB);
    await flush();

    expect(gate().status).toBe("show");
    expect(teamsIntroStorageKey(ALICE)).not.toBe(teamsIntroStorageKey(BOB));
  });

  it("a completion made offline is not shown again, and reaches the server later", async () => {
    server.set(CARA, null);
    rpcFails = true;
    open(CARA);
    await flush();
    await act(async () => gate().complete());
    close();

    expect(server.get(CARA)).toBeNull();

    rpcFails = false;
    open(CARA);
    await flush();

    expect(gate().status).toBe("hidden");
    expect(server.get(CARA)).toBeTruthy();
  });

  it("with the server unreachable and nothing on the device, a first visit is still explained", async () => {
    serverDown = true;
    open(DEAN);
    await flush();

    expect(gate().status).toBe("show");
  });
});

describe("the rules, without React", () => {
  it("shows only when neither the server nor the device says it was finished", () => {
    expect(shouldShowTeamsIntro({ server: "pending", completedOnDevice: false })).toBe(true);
    expect(shouldShowTeamsIntro({ server: "unknown", completedOnDevice: false })).toBe(true);
    expect(shouldShowTeamsIntro({ server: "completed", completedOnDevice: false })).toBe(false);
    expect(shouldShowTeamsIntro({ server: "pending", completedOnDevice: true })).toBe(false);
  });

  it("walks 1/3 → 2/3 → 3/3, back again, and never past either end", () => {
    const copy = getTeamsIntroCopy("en");
    const seen: string[] = [];
    let index = 0;

    for (let press = 0; press < 3; press += 1) {
      seen.push(copy.progress(index + 1, TEAMS_INTRO_STEPS.length));
      index = teamsIntroReducer(index, { type: "continue" });
    }

    expect(seen).toEqual(["1/3", "2/3", "3/3"]);
    expect(index).toBe(2);
    expect(isLastIntroStep(index)).toBe(true);
    expect(teamsIntroReducer(teamsIntroReducer(2, { type: "back" }), { type: "back" })).toBe(0);
    expect(teamsIntroReducer(0, { type: "back" })).toBe(0);
    expect(clampIntroStep(99)).toBe(2);
    expect(copy.progressSpoken(2, 3)).toBe("Step 2 of 3");
    expect(getTeamsIntroCopy("fr").progressSpoken(2, 3)).toBe("Étape 2 sur 3");
  });

  it("opens 'How scoring works' on the points", () => {
    expect(TEAMS_INTRO_STEPS[SCORING_STEP_INDEX]).toBe("points");
  });
});

describe("what it says", () => {
  for (const language of ["en", "fr"] as const) {
    const copy = getTeamsIntroCopy(language);
    const teams = getTeamsCopy(language);
    const all = JSON.stringify(copy);

    it(`${language}: how to play — 20 seconds, played once, questions at the end`, () => {
      const play = JSON.stringify(copy.play);

      expect(play).toMatch(/20/);
      expect(play).toMatch(language === "fr" ? /qu'une fois/ : /only once/);
      expect(play).toMatch(language === "fr" ? /Mini cas/ : /Mini Cases/);
    });

    it(`${language}: points are 1, 0.6, 0.3, 0 — quality of reasoning — and a timeout has no retry`, () => {
      expect(copy.points.tiers.map((tier) => tier.value)).toEqual(
        language === "fr" ? ["1", "0,6", "0,3", "0"] : ["1", "0.6", "0.3", "0"]
      );
      expect(copy.points.tiers.map((tier) => tier.name)).toEqual(
        language === "fr" ? ["Excellent", "Bon", "Partiel", "Manqué"] : ["Excellent", "Good", "Partial", "Miss"]
      );
      expect(copy.points.tiers.map((tier) => tier.share)).toEqual([1, 0.6, 0.3, 0]);
      expect(copy.points.title).toMatch(language === "fr" ? /raisonnement/ : /reasoned/);
      expect(copy.points.timeout.body).toMatch(language === "fr" ? /Pas de second essai/ : /No retry/);
    });

    it(`${language}: Teams — private, one answer that counts for both, the three leaderboards, live`, () => {
      const body = JSON.stringify(copy.teams);

      expect(body).toMatch(language === "fr" ? /privées/ : /private/);
      expect(body).toMatch(language === "fr" ? /ne la rejouez jamais/ : /never replay it/);
      for (const range of [teams.rangeEdition, teams.rangeWeek, teams.rangeAllTime]) {
        expect(body, range).toContain(range);
      }
      if (language === "en") {
        expect(body).toContain("Scores update live as your team answers.");
      }
      expect(body).not.toMatch(/instant/i);
    });

    it(`${language}: in the product's register — no exclamation marks, no emoji`, () => {
      expect(all).not.toContain("!");
      expect(all).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
      if (language === "fr") {
        expect(all).not.toMatch(/\b(tu|ton|ta|tes)\b/);
      }
    });
  }
});

describe("the screens", () => {
  const read = (...segments: string[]) =>
    readFileSync(join(__dirname, ...segments), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const intro = read("TeamsIntro.tsx");
  const landing = read("TeamsLandingScreen.tsx");
  const route = read("..", "..", "..", "app", "(teams)", "how-scoring-works.tsx");

  it("the landing opens on the introduction only when the gate says so, and finishing it records it", () => {
    expect(landing).toContain('introGate.status === "show"');
    expect(landing).toContain('mode="first_open"');
    expect(landing).toContain("onFinish={() => void introGate.complete()}");
    expect(landing).toContain('introGate.status === "checking"');
  });

  it("'How scoring works' is linked from Teams and reopens the pages without recording anything", () => {
    expect(landing).toContain('"/(teams)/how-scoring-works"');
    expect(route).toContain("TeamsScoringGuideScreen");
    expect(intro).toContain('mode="manual"');
    expect(intro).toContain("onFinish={() => router.back()}");
    expect(intro).not.toMatch(/teamsIntroData|useTeamsIntroGate|complete_teams_intro|AsyncStorage/);
  });

  it("follows the theme in dark and light, and speaks its structure", () => {
    expect(intro).toContain("useThemedStyles(createStyles)");
    expect(intro).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(intro).not.toMatch(/rgba?\(/);
    expect(intro).toContain('accessibilityRole="progressbar"');
    expect(intro).toContain('accessibilityRole="header"');
    expect(intro).toMatch(/<PrimaryButton/);
    expect(intro).toContain("useReducedMotion");
  });
});
