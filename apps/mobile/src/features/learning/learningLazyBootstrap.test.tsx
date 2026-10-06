// react / react-dom resolve to apps/mobile/node_modules (React 19) because this
// file lives under apps/mobile — the same copy the provider itself uses.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A reader with the learning path switched off does not pay for it at startup.
 *
 * The full bootstrap is a schema check, domains, objectives, the preference
 * row, the paths (and their sessions) plus an outbox drain. It now runs when
 * the path is on, or when a screen that shows learning data mounts — not on
 * every cold start of every reader.
 */

vi.stubGlobal("__DEV__", false);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

type Flags = { newsletter: boolean; business_story: boolean; mini_case: boolean; learning_path: boolean };

const calls: string[] = [];
const OFF: Flags = { newsletter: true, business_story: true, mini_case: true, learning_path: false };
const ON: Flags = { ...OFF, learning_path: true };

let learningEnabledInDb = false;
const applyModuleFlags = vi.fn();
let auth: Record<string, unknown>;

vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) }
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve()
  }
}));

vi.mock("../auth", () => ({ useAuth: () => auth }));

function query(table: string) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = () =>
    Promise.resolve({
      data:
        table === "user_preferences"
          ? { learning_path_enabled: learningEnabledInDb, learning_path_choice_completed: true }
          : null,
      error: null
    });
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  return builder;
}

vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: (name: string) => {
      calls.push(`rpc:${name}`);
      return Promise.resolve({
        data:
          name === "learning_paths_healthcheck"
            ? {
                schema_version: "1.1",
                ready: true,
                domain_count: 7,
                objective_count: 21,
                start_rpc_ready: true,
                session_lifecycle_ready: true,
                columns_ready: true,
                functions_ready: true,
                constraints_ready: true,
                indexes_ready: true,
                rls_ready: true
              }
            : null,
        error: null
      });
    },
    from: (table: string) => {
      calls.push(`from:${table}`);
      return query(table);
    }
  },
  hasSupabaseConfig: true,
  getSupabaseConfigError: () => null,
  normalizeSupabaseError: (error: unknown, fallback?: string) => ({
    message: (error as { message?: string })?.message ?? fallback ?? "error"
  })
}));

const { LearningPathProvider, useLearningPath } = await import("./LearningPathContext");
const { useLearningPathData } = await import("./useLearningPathData");

type Value = ReturnType<typeof useLearningPath>;
let latest: Value;
let root: Root | null = null;

function Tabs() {
  latest = useLearningPath();
  return null;
}

function PathScreen() {
  latest = useLearningPathData();
  return null;
}

async function settle() {
  for (let index = 0; index < 15; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(children: React.ReactNode) {
  await act(async () => {
    root!.render(<LearningPathProvider>{children}</LearningPathProvider>);
  });
  await settle();
}

function setAuth(flags: Flags | null) {
  auth = {
    applyModuleFlags,
    moduleFlags: flags,
    profileLanguage: "fr",
    status: "ready",
    user: { id: "reader-a" }
  };
}

beforeEach(() => {
  calls.length = 0;
  applyModuleFlags.mockClear();
  learningEnabledInDb = false;
  setAuth(OFF);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
});

describe("learning switched off", () => {
  it("cold start makes no learning request", async () => {
    await render(<Tabs />);

    expect(calls).toEqual([]);
    expect(latest.learningPathEnabled).toBe(false);
    // Not "ready with no path", which would read as an empty Parcours.
    expect(latest.status).toBe("loading");
  });

  it("opening a screen that shows learning data loads it then", async () => {
    await render(<Tabs />);
    expect(calls).toEqual([]);

    await render(
      <>
        <Tabs />
        <PathScreen />
      </>
    );

    expect(calls).toContain("rpc:learning_paths_healthcheck");
    expect(calls).toContain("from:learning_domains");
    expect(latest.status).toBe("ready");
  });

  it("switching it on in Settings loads it once", async () => {
    await render(<Tabs />);
    learningEnabledInDb = true;
    setAuth(ON);

    await render(<Tabs />);

    expect(calls.filter((call) => call === "rpc:learning_paths_healthcheck")).toHaveLength(1);
    expect(latest.learningPathEnabled).toBe(true);
  });
});

describe("learning switched on", () => {
  it("still bootstraps at startup, as before", async () => {
    learningEnabledInDb = true;
    setAuth(ON);

    await render(<Tabs />);

    expect(calls).toContain("rpc:learning_paths_healthcheck");
    expect(latest.status).toBe("ready");
    expect(latest.learningPathEnabled).toBe(true);
  });

  it("flags not known yet: the old eager bootstrap, never a skipped load", async () => {
    setAuth(null);

    await render(<Tabs />);

    expect(calls).toContain("rpc:learning_paths_healthcheck");
  });

  it("keeps the in-memory module flags true to what it read", async () => {
    learningEnabledInDb = true;
    setAuth(ON);

    await render(<Tabs />);

    expect(applyModuleFlags).toHaveBeenCalledWith({ learning_path: true });
  });
});
