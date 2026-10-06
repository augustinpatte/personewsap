import { describe, expect, it } from "vitest";

import {
  assertCommandTarget,
  COMMAND_TARGETS,
  PRODUCTION_PROJECT_REF,
  ProjectTargetError,
  resolveSupabaseTarget,
  STAGING_PROJECT_REF
} from "./projectRef.js";

const PRODUCTION_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const STAGING_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;

describe("K. a writing command refuses an unconfirmed or wrong project", () => {
  it("requires the target to be declared", () => {
    expect(() => assertCommandTarget("daily-job", { SUPABASE_URL: PRODUCTION_URL })).toThrow(
      /EXPECTED_SUPABASE_REF=wkbviidrbmehmjbhvpeh/
    );
  });

  it("refuses a mismatch between SUPABASE_URL and the declared target", () => {
    expect(() =>
      assertCommandTarget("push-notifications", {
        SUPABASE_URL: STAGING_URL,
        EXPECTED_SUPABASE_REF: PRODUCTION_PROJECT_REF
      })
    ).toThrow(ProjectTargetError);
  });

  it("accepts a production writer pointed at the declared production project", () => {
    expect(
      assertCommandTarget("daily-job", {
        SUPABASE_URL: PRODUCTION_URL,
        EXPECTED_SUPABASE_REF: PRODUCTION_PROJECT_REF
      })
    ).toEqual({ kind: "production-write", target: PRODUCTION_PROJECT_REF });
  });

  it("treats an unclassified command as a writer", () => {
    expect(() => assertCommandTarget("some-new-command", { SUPABASE_URL: PRODUCTION_URL })).toThrow(
      ProjectTargetError
    );
  });

  it("lets read-only commands and credential-less runs through", () => {
    expect(assertCommandTarget("notification-health", { SUPABASE_URL: PRODUCTION_URL }).target).toBeNull();
    expect(assertCommandTarget("daily-job", {}).target).toBeNull();
  });

  it("refuses a URL that names no project", () => {
    expect(() =>
      assertCommandTarget("daily-job", {
        SUPABASE_URL: "https://proxy.example.com",
        EXPECTED_SUPABASE_REF: PRODUCTION_PROJECT_REF
      })
    ).toThrow(/does not name a Supabase project/);
  });
});

describe("L. a test or destructive command cannot target production by accident", () => {
  for (const command of ["cleanup-test", "persist-test", "assign-test-users", "daily-job-test", "personalize-test"]) {
    it(`${command} refuses production even when production is the declared target`, () => {
      expect(() =>
        assertCommandTarget(command, {
          SUPABASE_URL: PRODUCTION_URL,
          EXPECTED_SUPABASE_REF: PRODUCTION_PROJECT_REF
        })
      ).toThrow(/test\/destructive command and SUPABASE_URL is PRODUCTION/);
    });
  }

  it("runs against staging or a local stack", () => {
    expect(
      assertCommandTarget("cleanup-test", { SUPABASE_URL: STAGING_URL, EXPECTED_SUPABASE_REF: STAGING_PROJECT_REF }).target
    ).toBe(STAGING_PROJECT_REF);
    expect(
      assertCommandTarget("cleanup-test", { SUPABASE_URL: "http://127.0.0.1:54321", EXPECTED_SUPABASE_REF: "local" }).target
    ).toBe("local");
  });

  it("only the named break-glass, typed with the production ref, lets it through", () => {
    const env = { SUPABASE_URL: PRODUCTION_URL, EXPECTED_SUPABASE_REF: PRODUCTION_PROJECT_REF };

    expect(() => assertCommandTarget("cleanup-test", { ...env, PERSONEWS_TEST_WRITES_TO_PRODUCTION: "true" })).toThrow();
    expect(
      assertCommandTarget("cleanup-test", { ...env, PERSONEWS_TEST_WRITES_TO_PRODUCTION: PRODUCTION_PROJECT_REF }).target
    ).toBe(PRODUCTION_PROJECT_REF);
  });

  it("every destructive command is classified as a test command", () => {
    expect(COMMAND_TARGETS["cleanup-test"]).toBe("test-write");
    expect(COMMAND_TARGETS["persist-test"]).toBe("test-write");
  });

  it("resolves loopback stacks as local", () => {
    expect(resolveSupabaseTarget("http://localhost:54321")).toBe("local");
    expect(resolveSupabaseTarget(PRODUCTION_URL)).toBe(PRODUCTION_PROJECT_REF);
  });
});
