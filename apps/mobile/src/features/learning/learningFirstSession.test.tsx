// react / react-dom resolve to apps/mobile/node_modules (React 19) because this
// file lives under apps/mobile — the same copy the provider itself uses. The
// repo root ships React 18 for the web app, so the root testing-library render
// would mix two React runtimes; rendering through react-dom/client here keeps a
// single consistent pair.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearMemoryCache } from "../../lib/memoryCache";
import type { LearningSession } from "./learningTypes";

/**
 * How a learning path starts and advances, against a stand-in database that
 * enforces the same rules as the SQL:
 *
 *  - create_next_learning_session returns the session already waiting instead
 *    of making a second one (the advisory lock / idempotence contract);
 *  - a session is never attached to a daily drop.
 *
 * What is asserted is the product behaviour asked for: creating a path
 * materialises Session 1 immediately, and Session 2 exists only after an
 * explicit reader action — never because an edition was published.
 */

const DOMAIN_ID = "11111111-1111-4111-8111-111111111111";
const OBJECTIVE_ID = "22222222-2222-4222-8222-222222222222";
const PATH_ID = "33333333-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;

const db: { paths: Row[]; sessions: Row[] } = { paths: [], sessions: [] };
const rpcSpy = vi.fn();
const tableSpy = vi.fn();

vi.stubGlobal("__DEV__", false);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: () => {} })
  }
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve()
  }
}));

vi.mock("../auth", () => ({
  useAuth: () => ({
    profileLanguage: "fr",
    status: "ready",
    user: { id: "44444444-4444-4444-8444-444444444444" }
  })
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Row) => runRpc(name, args),
    from: (table: string) => {
      tableSpy(table);
      return createQuery(table);
    }
  },
  hasSupabaseConfig: true,
  getSupabaseConfigError: () => null,
  normalizeSupabaseError: (error: unknown, fallback?: string) => ({
    code: (error as { code?: string })?.code,
    message: (error as { message?: string })?.message ?? fallback ?? "error"
  })
}));

const { LearningPathProvider, useLearningPath } = await import("./LearningPathContext");

const catalogSteps = [1, 2, 3].map((order) => ({
  key: `step-${order}`,
  domain_id: DOMAIN_ID,
  objective_ids: [OBJECTIVE_ID],
  stage: 1,
  order,
  required: true,
  prerequisite_keys: [],
  fallback_key: null,
  title_fr: `Étape ${order}`,
  title_en: `Step ${order}`,
  summary_fr: `Résumé ${order}`,
  summary_en: `Summary ${order}`,
  learning_goals_fr: [`Objectif ${order}`],
  learning_goals_en: [`Goal ${order}`],
  tutor_focus_fr: `Focus ${order}`,
  tutor_focus_en: `Focus ${order}`,
  example_contexts_fr: [`Contexte ${order}`],
  example_contexts_en: [`Context ${order}`],
  safety_category: null
}));

const healthcheck = {
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
};

function runRpc(name: string, args: Row) {
  if (name === "learning_paths_healthcheck") {
    return Promise.resolve({ data: healthcheck, error: null });
  }

  if (name === "start_learning_path") {
    db.paths.push({
      id: PATH_ID,
      user_id: "44444444-4444-4444-8444-444444444444",
      domain_id: args.p_domain_id,
      objective_id: args.p_objective_id,
      current_level: args.p_current_level,
      target_level: args.p_target_level,
      language: "fr",
      status: "active",
      created_at: "2026-08-17T10:00:00.000Z",
      updated_at: "2026-08-17T10:00:00.000Z",
      archived_at: null,
      completed_at: null
    });

    return Promise.resolve({ data: PATH_ID, error: null });
  }

  if (name === "create_next_learning_session") {
    // Mirrors the SQL: a ready, unfinished session is returned as is.
    const waiting = db.sessions.find(
      (session) =>
        session.path_id === PATH_ID &&
        session.generation_status === "ready" &&
        ["available", "opened"].includes(session.status as string)
    );

    if (waiting) {
      return Promise.resolve({ data: waiting, error: null });
    }

    const session = {
      id: `session-${db.sessions.length + 1}`,
      path_id: PATH_ID,
      // Never bound to an edition: this is the whole point of self-paced.
      daily_drop_id: null,
      curriculum_step_key: args.p_curriculum_step_key,
      skipped_step_key: args.p_skipped_step_key,
      session_number: db.sessions.length + 1,
      adaptation_mode: args.p_adaptation_mode,
      language: "fr",
      title_fr: args.p_title_fr,
      title_en: args.p_title_en,
      summary_fr: args.p_summary_fr,
      summary_en: args.p_summary_en,
      objectives_fr: args.p_objectives_fr,
      objectives_en: args.p_objectives_en,
      prompt_text: args.p_prompt_text,
      generation_status: "ready",
      status: "available",
      available_on: null,
      opened_at: null,
      started_at: null,
      completed_at: null,
      created_at: "2026-08-17T10:00:00.000Z"
    };

    db.sessions.push(session);

    return Promise.resolve({ data: session, error: null });
  }

  return Promise.resolve({ data: null, error: { code: "unknown_rpc", message: name } });
}

/** Minimal filter-aware query stub over the fake tables. */
function createQuery(table: string) {
  const filters: Row = {};
  const builder: Record<string, unknown> = {};

  const rows = () => {
    if (table === "user_learning_paths") {
      return db.paths.filter((row) =>
        Object.entries(filters).every(([column, value]) => row[column] === value)
      );
    }

    if (table === "learning_sessions") {
      return db.sessions.filter((row) =>
        Object.entries(filters).every(([column, value]) => row[column] === value)
      );
    }

    if (table === "user_preferences") {
      return [{ learning_path_enabled: true, learning_path_choice_completed: true }];
    }

    if (table === "learning_catalog_domains") {
      return [{ domain_id: DOMAIN_ID, version: "v1", payload: { steps: catalogSteps } }];
    }

    if (table === "learning_domains") {
      return [
        {
          id: DOMAIN_ID,
          slug: "artificial_intelligence",
          label_fr: "IA",
          label_en: "AI",
          description_fr: "",
          description_en: "",
          position: 1
        }
      ];
    }

    if (table === "learning_objectives") {
      return [
        {
          id: OBJECTIVE_ID,
          domain_id: DOMAIN_ID,
          slug: "understand",
          label_fr: "Comprendre",
          label_en: "Understand",
          description_fr: "",
          description_en: "",
          position: 1
        }
      ];
    }

    return [];
  };

  builder.select = () => builder;
  builder.order = () => builder;
  builder.limit = () => builder;
  builder.in = () => builder;
  builder.eq = (column: string, value: unknown) => {
    filters[column] = value;
    return builder;
  };
  builder.update = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: rows(), error: null }).then(resolve);

  return builder;
}

type LearningPathValue = ReturnType<typeof useLearningPath>;

type Probe = {
  bundle: LearningPathValue | null;
  startPath: (() => Promise<unknown>) | null;
  advance: (() => Promise<{ session: LearningSession | null }>) | null;
};

const probe: Probe = { bundle: null, startPath: null, advance: null };

function ProbeComponent() {
  const learningPath = useLearningPath();

  probe.bundle = learningPath;
  probe.startPath = () =>
    learningPath.startPath({
      domainId: DOMAIN_ID,
      objectiveId: OBJECTIVE_ID,
      currentLevel: 1,
      targetLevel: 3
    });
  probe.advance = () => learningPath.advanceLearningPath();

  return null;
}

let root: Root | null = null;

async function renderProvider() {
  const container = document.createElement("div");
  document.body.append(container);

  await act(async () => {
    root = createRoot(container);
    root.render(
      <LearningPathProvider>
        <ProbeComponent />
      </LearningPathProvider>
    );
  });

  await waitFor(() => probe.bundle?.status === "ready");
}

/** Flush pending effects/promises until `predicate` holds. */
async function waitFor(predicate: () => boolean, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }

    await act(async () => {
      await Promise.resolve();
    });
  }

  expect(predicate()).toBe(true);
}

beforeEach(async () => {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
    root = null;
  }

  db.paths = [];
  db.sessions = [];
  probe.bundle = null;
  rpcSpy.mockReset();
  tableSpy.mockReset();
  clearMemoryCache("learning-catalog");
});

describe("creating a learning path", () => {
  it("prepares Session 1 immediately, so the Parcours tab is never empty", async () => {
    await renderProvider();

    expect(db.sessions).toHaveLength(0);

    await act(async () => {
      await probe.startPath?.();
    });

    // One session, materialised by the act of creating the path.
    expect(db.sessions).toHaveLength(1);

    await waitFor(() => probe.bundle?.availableSession?.session_number === 1);

    const session = probe.bundle?.availableSession;
    expect(session?.title_fr).toBe("Étape 1");
    expect(session?.status).toBe("available");
    // Self-paced: nothing links the session to an edition.
    expect(session?.daily_drop_id).toBeNull();
    expect(session?.available_on).toBeNull();
    expect(tableSpy).not.toHaveBeenCalledWith("daily_drops");
    expect(tableSpy).not.toHaveBeenCalledWith("daily_drop_items");
  });

  it("never pre-generates more than that one session", async () => {
    await renderProvider();

    await act(async () => {
      await probe.startPath?.();
    });
    // A second advance while Session 1 is still waiting opens it, it does not
    // create Session 2.
    await act(async () => {
      await probe.advance?.();
    });

    expect(db.sessions).toHaveLength(1);
  });
});

describe("advancing a learning path", () => {
  it("creates Session 2 only on an explicit reader action", async () => {
    await renderProvider();

    await act(async () => {
      await probe.startPath?.();
    });

    // Finish Session 1 the way the feedback flow does.
    db.sessions[0].status = "completed";
    db.sessions[0].completed_at = "2026-08-17T11:00:00.000Z";

    await act(async () => {
      await probe.bundle?.reload();
    });

    // Nothing has been prepared just because the first one is done.
    expect(db.sessions).toHaveLength(1);
    expect(probe.bundle?.availableSession).toBeNull();

    await act(async () => {
      await probe.advance?.();
    });

    expect(db.sessions).toHaveLength(2);
    expect(db.sessions[1].session_number).toBe(2);
    expect(db.sessions[1].curriculum_step_key).toBe("step-2");
    expect(db.sessions[1].daily_drop_id).toBeNull();
  });

  it("runs three sessions back to back without any edition", async () => {
    await renderProvider();

    await act(async () => {
      await probe.startPath?.();
    });

    for (let sessionNumber = 1; sessionNumber <= 2; sessionNumber += 1) {
      db.sessions[sessionNumber - 1].status = "completed";
      db.sessions[sessionNumber - 1].completed_at = "2026-08-17T11:00:00.000Z";

      await act(async () => {
        await probe.bundle?.reload();
      });
      await act(async () => {
        await probe.advance?.();
      });
    }

    expect(db.sessions.map((session) => session.session_number)).toEqual([1, 2, 3]);
    expect(db.sessions.map((session) => session.curriculum_step_key)).toEqual([
      "step-1",
      "step-2",
      "step-3"
    ]);
    expect(tableSpy).not.toHaveBeenCalledWith("daily_drops");
  });
});
