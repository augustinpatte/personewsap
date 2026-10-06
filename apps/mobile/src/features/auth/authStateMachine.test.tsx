// react / react-dom resolve to apps/mobile/node_modules (React 19) because this
// file lives under apps/mobile, the same copy the provider itself uses.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The AuthProvider state machine, rendered for real against a stand-in
 * Supabase that counts every read.
 *
 * The rule under test: `needsOnboarding` is only ever the result of a
 * SUCCESSFUL read proving the profile incomplete. A timeout, a 5xx or an
 * offline moment must never send an onboarded reader back into onboarding,
 * and a token refresh must not re-run the profile bootstrap at all.
 */

vi.stubGlobal("__DEV__", false);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string; status?: number } | null };
type AuthEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED";
type FakeSession = { access_token: string; user: { id: string; email: string } };
type Listener = (event: AuthEvent, session: FakeSession | null) => void;

const USER_ID = "user-aaaa-bbbb-0001";

function sessionFor(token: string, userId = USER_ID): FakeSession {
  return { access_token: token, user: { id: userId, email: "reader@example.com" } };
}

const ONBOARDED: Record<string, Result> = {
  profiles: { data: { id: USER_ID, language: "fr" }, error: null },
  user_preferences: {
    data: {
      user_id: USER_ID,
      newsletter_enabled: true,
      mini_cases_enabled: true,
      learning_path_choice_completed: true
    },
    error: null
  },
  user_topic_preferences: { data: { topic_id: "tech_ai" }, error: null },
  user_mini_case_topic_preferences: { data: { topic_id: "ai" }, error: null }
};

const TIMEOUT = { code: "57014", message: "canceling statement due to statement timeout" };
const SERVER_ERROR = { code: "PGRST000", message: "Internal Server Error", status: 503 };
const JWT_EXPIRED = { code: "PGRST301", message: "JWT expired" };

let responses: Record<string, Result> = {};
let reads: string[] = [];
let inserts: Array<{ table: string; row: Row }> = [];
let listener: Listener | null = null;
let storedSession: FakeSession | null = null;
let validatedSession: { data: FakeSession | null; error: Result["error"] } = {
  data: null,
  error: null
};
let emitDuringValidation: AuthEvent | null = null;
let throwOn: string | null = null;
// While set, every read waits for it: lets a test observe the render between a
// new session and its profile read.
let readGate: Promise<void> | null = null;
const clearLocalAuthSession = vi.fn(() => Promise.resolve());

function query(table: string) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    limit: () => builder,
    maybeSingle: () => {
      reads.push(table);
      if (throwOn === table) {
        return Promise.reject(new TypeError("Network request failed"));
      }
      const respond = () => responses[table] ?? { data: null, error: null };
      return readGate ? readGate.then(respond) : Promise.resolve(respond());
    },
    insert: (row: Row) => {
      inserts.push({ table, row });
      return Promise.resolve({ data: null, error: null });
    }
  };

  return builder;
}

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => query(table),
    auth: {
      onAuthStateChange: (callback: Listener) => {
        listener = callback;
        return { data: { subscription: { unsubscribe: () => (listener = null) } } };
      },
      signInWithPassword: () =>
        Promise.resolve({ data: { session: sessionFor("signed-in-token") }, error: null })
    }
  },
  hasSupabaseConfig: true,
  supabaseConfigDiagnostics: {},
  getSupabaseConfigError: () => null,
  applySupabaseAuthUrl: () => Promise.resolve({ data: null, error: null }),
  clearLocalAuthSession: () => clearLocalAuthSession(),
  getAuthSession: () => Promise.resolve({ data: storedSession, error: null }),
  getValidatedAuthSession: async () => {
    if (emitDuringValidation) {
      // supabase-js emits INITIAL_SESSION as soon as a listener is attached,
      // i.e. while the explicit bootstrap is still validating.
      listener?.(emitDuringValidation, storedSession);
    }
    return validatedSession;
  },
  signOut: () => Promise.resolve({ data: null, error: null }),
  isAuthSessionError: (error: { code?: string; message: string } | null) =>
    Boolean(error) &&
    (error!.code === "session_expired" || error!.message.toLowerCase().includes("jwt expired")),
  normalizeSupabaseError: (error: { code?: string; message?: string; status?: number } | null, fallback?: string) => ({
    code: error?.code,
    message: error?.message ?? fallback ?? "error",
    status: error?.status
  })
}));

vi.mock("expo-linking", () => ({
  getInitialURL: () => Promise.resolve(null),
  addEventListener: () => ({ remove: () => undefined })
}));

vi.mock("../notifications/pushNotificationPreferences", () => ({
  disablePushNotificationsForUser: () => Promise.resolve({ ok: true })
}));

vi.mock("../../lib/analytics", () => ({ trackAnalyticsEvent: () => undefined }));
vi.mock("../../lib/useBootLanguage", () => ({ rememberBootLanguage: () => undefined }));

const { AuthProvider, useAuth } = await import("./AuthProvider");

type AuthValue = ReturnType<typeof useAuth>;

let latest: AuthValue;
let observed: string[] = [];
let root: Root | null = null;

function Probe() {
  latest = useAuth();
  observed.push(latest.status);
  return null;
}

async function settle() {
  for (let index = 0; index < 12; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount() {
  const container = document.createElement("div");
  root = createRoot(container);

  await act(async () => {
    root!.render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
  });
  await settle();
}

async function emit(event: AuthEvent, session: FakeSession | null) {
  await act(async () => {
    listener?.(event, session);
  });
  await settle();
}

function givenSignedIn(rows: Record<string, Result> = ONBOARDED) {
  storedSession = sessionFor("token-1");
  validatedSession = { data: storedSession, error: null };
  responses = { ...rows };
}

beforeEach(() => {
  responses = {};
  reads = [];
  inserts = [];
  listener = null;
  storedSession = null;
  validatedSession = { data: null, error: null };
  emitDuringValidation = null;
  throwOn = null;
  readGate = null;
  observed = [];
  clearLocalAuthSession.mockClear();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
});

describe("cold start", () => {
  it("I. an onboarded reader reaches ready in one parallel round of four reads", async () => {
    givenSignedIn();

    await mount();

    expect(latest.status).toBe("ready");
    expect(latest.profileLanguage).toBe("fr");
    expect(latest.profileCompleted).toBe(true);
    expect(reads.sort()).toEqual(
      ["profiles", "user_mini_case_topic_preferences", "user_preferences", "user_topic_preferences"].sort()
    );
  });

  it("F. INITIAL_SESSION during the bootstrap does not start a second bootstrap", async () => {
    givenSignedIn();
    emitDuringValidation = "INITIAL_SESSION";

    await mount();

    expect(latest.status).toBe("ready");
    expect(reads).toHaveLength(4);
  });

  it("J. a brand-new account gets a profile and goes to onboarding", async () => {
    givenSignedIn({});

    await mount();

    expect(inserts).toEqual([
      expect.objectContaining({ table: "profiles", row: expect.objectContaining({ id: USER_ID, language: "en" }) })
    ]);
    expect(latest.status).toBe("needsOnboarding");
  });

  it("D. a profile that is genuinely incomplete goes to onboarding", async () => {
    givenSignedIn({
      ...ONBOARDED,
      user_preferences: {
        data: {
          user_id: USER_ID,
          newsletter_enabled: true,
          mini_cases_enabled: true,
          learning_path_choice_completed: false
        },
        error: null
      }
    });

    await mount();

    expect(latest.status).toBe("needsOnboarding");
    expect(latest.profileCompleted).toBe(false);
  });

  it("E. an expired session is signed out", async () => {
    storedSession = sessionFor("stale");
    validatedSession = { data: null, error: { code: "session_expired", message: "Session expired" } };

    await mount();

    expect(latest.status).toBe("signedOut");
    expect(latest.session).toBeNull();
    expect(reads).toHaveLength(0);
  });

  it("E. a profile read rejected for an expired JWT signs out and clears the local session", async () => {
    givenSignedIn({ ...ONBOARDED, profiles: { data: null, error: JWT_EXPIRED } });

    await mount();

    expect(latest.status).toBe("signedOut");
    expect(clearLocalAuthSession).toHaveBeenCalledTimes(1);
  });

  it("keeps a stored session when the auth server itself fails validation", async () => {
    storedSession = sessionFor("token-1");
    validatedSession = { data: null, error: { code: "unexpected_failure", message: "Internal Server Error", status: 500 } };
    responses = { ...ONBOARDED };

    await mount();

    expect(latest.status).toBe("ready");
    expect(latest.session?.access_token).toBe("token-1");
  });
});

describe("transient failures are never 'incomplete'", () => {
  it.each([
    ["A. a timeout", TIMEOUT],
    ["B. a Supabase 5xx", SERVER_ERROR]
  ])("%s at cold start is a retryable profileError, still signed in", async (_name, failure) => {
    givenSignedIn({ ...ONBOARDED, user_preferences: { data: null, error: failure } });

    await mount();

    expect(latest.status).toBe("profileError");
    expect(observed).not.toContain("needsOnboarding");
    expect(latest.session?.access_token).toBe("token-1");
    expect(latest.error?.code).toBe(failure.code);
    expect(clearLocalAuthSession).not.toHaveBeenCalled();
  });

  it("a thrown network error (fetch rejects) at cold start is a profileError too", async () => {
    givenSignedIn();
    throwOn = "user_topic_preferences";

    await mount();

    expect(latest.status).toBe("profileError");
    expect(latest.error?.message).toBe("Network request failed");
    expect(observed).not.toContain("needsOnboarding");
  });

  it.each([
    ["A. a timeout", TIMEOUT],
    ["B. a Supabase 5xx", SERVER_ERROR]
  ])("%s on a quiet refresh keeps an onboarded reader ready", async (_name, failure) => {
    givenSignedIn();
    await mount();
    expect(latest.status).toBe("ready");

    responses.profiles = { data: null, error: failure };
    observed = [];

    let returned: unknown;
    await act(async () => {
      returned = await latest.refreshProfile();
    });
    await settle();

    expect(returned).toMatchObject({ code: failure.code });
    expect(latest.status).toBe("ready");
    expect(observed).not.toContain("needsOnboarding");
    expect(observed).not.toContain("profileError");
    expect(latest.session).not.toBeNull();
  });

  it("H. retry from profileError reaches ready once the backend answers", async () => {
    givenSignedIn({ ...ONBOARDED, profiles: { data: null, error: TIMEOUT } });
    await mount();
    expect(latest.status).toBe("profileError");

    responses = { ...ONBOARDED };

    await act(async () => {
      await latest.refreshAuthState();
    });
    await settle();

    expect(latest.status).toBe("ready");
    expect(latest.error).toBeNull();
  });
});

describe("auth events", () => {
  it("C. TOKEN_REFRESHED updates the token without re-reading the profile", async () => {
    givenSignedIn();
    await mount();
    reads = [];
    observed = [];

    await emit("TOKEN_REFRESHED", sessionFor("token-2"));

    expect(reads).toHaveLength(0);
    expect(latest.session?.access_token).toBe("token-2");
    expect(latest.status).toBe("ready");
    expect(observed).not.toContain("loading");
  });

  it("C. TOKEN_REFRESHED while the backend is down cannot misroute anyone", async () => {
    givenSignedIn();
    await mount();
    responses.profiles = { data: null, error: SERVER_ERROR };

    await emit("TOKEN_REFRESHED", sessionFor("token-2"));

    expect(latest.status).toBe("ready");
  });

  it("a re-emitted SIGNED_IN for the same reader is only a token update", async () => {
    givenSignedIn();
    await mount();
    reads = [];

    await emit("SIGNED_IN", sessionFor("token-3"));

    expect(reads).toHaveLength(0);
    expect(latest.session?.access_token).toBe("token-3");
  });

  it("SIGNED_IN for a different reader resolves that reader", async () => {
    givenSignedIn();
    await mount();
    reads = [];

    await emit("SIGNED_IN", sessionFor("token-other", "user-other-0002"));

    expect(reads).toHaveLength(4);
    expect(latest.user?.id).toBe("user-other-0002");
  });

  it("SIGNED_OUT signs out", async () => {
    givenSignedIn();
    await mount();

    await emit("SIGNED_OUT", null);

    expect(latest.status).toBe("signedOut");
    expect(latest.session).toBeNull();
  });

  it("sign-in and the SIGNED_IN event it causes share one profile read", async () => {
    responses = { ...ONBOARDED };
    await mount();
    expect(latest.status).toBe("signedOut");
    reads = [];

    await act(async () => {
      const pending = latest.signInWithEmail({ email: "reader@example.com", password: "secret" });
      listener?.("SIGNED_IN", sessionFor("signed-in-token"));
      await pending;
    });
    await settle();

    expect(latest.status).toBe("ready");
    expect(reads).toHaveLength(4);
  });
});

describe("G. the Settings refresh is quiet", () => {
  it("never sets the global status to loading", async () => {
    givenSignedIn();
    await mount();
    observed = [];
    reads = [];

    await act(async () => {
      await latest.refreshProfile();
    });
    await settle();

    expect(reads).toHaveLength(4);
    expect(observed).not.toContain("loading");
    expect(latest.status).toBe("ready");
  });

  it("still applies a real change it reads back", async () => {
    givenSignedIn();
    await mount();

    responses.profiles = { data: { id: USER_ID, language: "en" }, error: null };

    await act(async () => {
      await latest.refreshProfile();
    });
    await settle();

    expect(latest.profileLanguage).toBe("en");
  });
});

describe("module flags: one in-memory copy, owned by its reader", () => {
  it("are read with the profile, in the same four reads", async () => {
    givenSignedIn({
      ...ONBOARDED,
      user_preferences: {
        data: { ...(ONBOARDED.user_preferences.data as Row), business_stories_enabled: false },
        error: null
      }
    });

    await mount();

    expect(reads).toHaveLength(4);
    expect(latest.moduleFlags).toEqual({
      newsletter: true,
      business_story: false,
      mini_case: true,
      learning_path: false
    });
  });

  it("a save updates them immediately, with no request", async () => {
    givenSignedIn();
    await mount();
    reads = [];

    await act(async () => {
      latest.applyModuleFlags({ mini_case: false, learning_path: true });
    });

    expect(latest.moduleFlags).toMatchObject({ mini_case: false, learning_path: true, newsletter: true });
    expect(reads).toEqual([]);
  });

  it("a different reader never sees the previous reader's flags", async () => {
    givenSignedIn();
    await mount();
    await act(async () => {
      latest.applyModuleFlags({ newsletter: false });
    });
    expect(latest.moduleFlags?.newsletter).toBe(false);

    // Reader B signs in on this device; hold their profile read open.
    const OTHER = "user-aaaa-bbbb-0002";
    let release: () => void = () => undefined;
    readGate = new Promise<void>((resolve) => (release = resolve));
    responses = { ...ONBOARDED, profiles: { data: { id: OTHER, language: "en" }, error: null } };

    await emit("SIGNED_IN", sessionFor("token-b", OTHER));

    // B's session is live, B's read has not answered: no flags at all,
    // and certainly not A's newsletter-off.
    expect(latest.user?.id).toBe(OTHER);
    expect(latest.moduleFlags).toBeNull();

    release();
    readGate = null;
    await settle();

    expect(latest.moduleFlags?.newsletter).toBe(true);
  });

  it("sign-out forgets them", async () => {
    givenSignedIn();
    await mount();
    expect(latest.moduleFlags).not.toBeNull();

    await emit("SIGNED_OUT", null);

    expect(latest.moduleFlags).toBeNull();
  });
});
