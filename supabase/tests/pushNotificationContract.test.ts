import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The push notification contract.
 *
 * This file exists because of a production outage that produced no error
 * anywhere an operator was looking: every workflow run was green, every edition
 * published, and `push_notification_deliveries` was empty for every edition this
 * product has ever published, because
 *
 *   claim_push_notification_deliveries → 42702 column reference
 *                                        "push_token_id" is ambiguous
 *
 * on every single call. Reproduced against production with a zero-row call —
 * `jsonb_to_recordset('[]')` yields no rows, so nothing was inserted and nothing
 * updated, and it still failed, which proves the error is raised when the
 * statement is planned rather than when a row is processed.
 *
 * What is checked here is mechanical and static: SQL cannot be executed in this
 * environment (no local Postgres, no database URL), and the SQL suite that CAN
 * execute needs a Supabase access token. So the properties that would have
 * caught this are pinned by reading the migrations, and the behavioural cases
 * live in supabase/tests/push_notification_claims.test.sql.
 */

const repoRoot = join(__dirname, "..", "..");
const read = (...segments: string[]) => readFileSync(join(repoRoot, ...segments), "utf8");
const migration = (name: string) => read("supabase", "migrations", name);

/**
 * Comments stripped.
 *
 * These migrations and workflows explain at length what went wrong, quoting the
 * broken `ON CONFLICT (push_token_id, …)` and the `continue-on-error` that is no
 * longer there. Structural assertions have to read the code, not the prose —
 * otherwise the only way to keep this file green would be to delete the
 * explanation, which is the opposite of what it is for.
 */
const stripSqlComments = (sql: string) =>
  sql.replace(/^\s*--.*$/gm, "");
const stripYamlComments = (yaml: string) =>
  yaml.replace(/^\s*#.*$/gm, "");

const brokenClaim = stripSqlComments(migration("20260818123000_push_receipts_and_atomic_claims.sql"));
const fixedClaim = stripSqlComments(migration("20260906080000_fix_push_notification_claim_ambiguity.sql"));
const outbox = stripSqlComments(migration("20260906081000_notification_outbox.sql"));
const dispatch = stripSqlComments(migration("20260906082000_notification_dispatch_cron.sql"));
const deliveriesTable = stripSqlComments(migration("20260818100000_push_notification_deliveries.sql"));

const store = read("services", "content-engine", "src", "notifications", "supabasePushStore.ts");
const sender = read("services", "content-engine", "src", "notifications", "pushSender.ts");
const domain = read("services", "content-engine", "src", "notifications", "editionNotification.ts");
const outboxClient = read("services", "content-engine", "src", "notifications", "notificationOutbox.ts");
const pushCli = read("services", "content-engine", "src", "cli", "pushNotifications.ts");
const dailyJobWorkflow = stripYamlComments(read(".github", "workflows", "content-daily-job.yml"));
const deliveryWorkflow = stripYamlComments(read(".github", "workflows", "push-notification-retry.yml"));
const receiptWorkflow = stripYamlComments(read(".github", "workflows", "push-receipts.yml"));
const mobilePreferences = read(
  "apps", "mobile", "src", "features", "notifications", "pushNotificationPreferences.ts"
);
const appConfig = read("apps", "mobile", "app.json");
const taskPublisher = read("supabase", "functions", "personews-task-publisher", "index.ts");

/**
 * Output columns of a PL/pgSQL `RETURNS TABLE`, which are also variables for the
 * whole body.
 */
function returnsTableColumns(sql: string, functionName: string): string[] {
  const start = sql.indexOf(functionName);
  const header = sql.slice(start, sql.indexOf("AS $", start));
  const match = /RETURNS TABLE\s*\(([\s\S]*?)\)\s*\n\s*LANGUAGE/i.exec(header);

  return match
    ? match[1]
        .split(",")
        .map((entry) => entry.trim().split(/\s+/)[0])
        .filter((name) => /^\w+$/.test(name))
    : [];
}

/** The column lists of every `ON CONFLICT (...)` inference clause in `sql`. */
function onConflictInferenceColumns(sql: string): string[] {
  return [...sql.matchAll(/ON CONFLICT\s*\(([^)]*)\)/gi)].flatMap((match) =>
    match[1].split(",").map((column) => column.trim())
  );
}

describe("the defect, stated mechanically", () => {
  it("the applied migration really does declare push_token_id as an output column", () => {
    expect(returnsTableColumns(brokenClaim, "claim_push_notification_deliveries")).toContain(
      "push_token_id"
    );
  });

  it("and really does name it in an ON CONFLICT inference list", () => {
    // Index inference accepts arbitrary expressions, because a unique index may
    // be partial or on an expression. It is therefore an expression context, and
    // PL/pgSQL substitutes variables in it — unlike an INSERT column list, which
    // is a list of column names and is never substituted. Those two facts
    // together are the whole bug.
    expect(onConflictInferenceColumns(brokenClaim)).toContain("push_token_id");
  });

  it("names the one column that collides and no other", () => {
    // drop_date and notification_kind are in the same clause and are not output
    // columns, which is why PostgreSQL named push_token_id specifically. If the
    // fault were anywhere else the error would have named something else.
    const outputs = returnsTableColumns(brokenClaim, "claim_push_notification_deliveries");

    expect(outputs).toHaveLength(1);
    expect(onConflictInferenceColumns(brokenClaim)).toEqual(
      expect.arrayContaining(["push_token_id", "drop_date", "notification_kind"])
    );
  });

  it("could not have been the identity index, which was never a named constraint", () => {
    // `ON CONFLICT ON CONSTRAINT` — the form that cannot be substituted — was
    // not available to the original author: the identity key was a bare
    // CREATE UNIQUE INDEX.
    expect(deliveriesTable).toContain("CREATE UNIQUE INDEX IF NOT EXISTS push_notification_deliveries_identity_unique");
    expect(deliveriesTable).not.toMatch(/ADD CONSTRAINT push_notification_deliveries_identity_unique/);
  });
});

describe("the fix", () => {
  it("does not edit the applied migration", () => {
    // 20260818123000 is applied in production. The repair is a new migration.
    expect(migration("20260818123000_push_receipts_and_atomic_claims.sql")).toContain(
      "RETURNS TABLE(push_token_id UUID)"
    );
  });

  it("KEEPS the published response shape: exactly { push_token_id: UUID }", () => {
    // THE DEPLOYMENT CONTRACT.
    //
    // Renaming this output column would fix the ambiguity in one line and make
    // the migration undeployable on its own: `main`'s sender reads
    // `row.push_token_id`, and a renamed column does not raise — it yields
    // `undefined`, the device is never added to the claimed set, and every
    // reader silently gets nothing. That is the same outage in a new costume,
    // and it would last exactly as long as the gap between applying the
    // migration and merging the branch.
    //
    // So the shape does not move, and this is the test that stops it moving.
    expect(returnsTableColumns(fixedClaim, "claim_push_notification_deliveries")).toEqual([
      "push_token_id"
    ]);
    expect(fixedClaim).toContain("RETURNS TABLE(push_token_id UUID)");
    expect(fixedClaim).not.toContain("claimed_push_token_id");
  });

  it("replaces the function in place rather than dropping and recreating it", () => {
    // The return type is unchanged, so CREATE OR REPLACE is legal — which means
    // no instant exists in which the function is absent, and the existing grants
    // survive the migration.
    expect(fixedClaim).toContain(
      "CREATE OR REPLACE FUNCTION public.claim_push_notification_deliveries"
    );
    expect(fixedClaim).not.toMatch(/DROP FUNCTION[^;]*claim_push_notification_deliveries/);
  });

  it("takes the same arguments under the same names", () => {
    // Supabase RPC sends named arguments, so a renamed parameter breaks an old
    // caller just as surely as a renamed output column does.
    for (const argument of ["p_rows JSONB", "p_claim_id TEXT", "p_claim_ttl_seconds INTEGER"]) {
      expect(fixedClaim, argument).toContain(argument);
    }
  });

  it("states the variable-conflict rule for the whole body", () => {
    // The output column deliberately shares a name with a column of the table
    // this function writes, so the collision is structural and permanent. The
    // resolution is declared once, at the top, instead of depending on nobody
    // ever adding an unqualified reference again.
    expect(fixedClaim).toContain("#variable_conflict use_column");
  });

  it("qualifies every reference to the colliding name", () => {
    // Layer two. Inside the body `push_token_id` appears only as an INSERT
    // column list entry, as a jsonb_to_recordset column definition, or behind an
    // alias. Whether that is exhaustive is not a thing prose can settle — it is
    // settled by C1 in push_notification_claims.test.sql, which calls the
    // function against a real PostgreSQL and would raise 42702 if one bare
    // reference were left.
    const body = fixedClaim.slice(
      fixedClaim.indexOf("AS $claim$"),
      fixedClaim.indexOf("$claim$;")
    );

    expect(body).toContain("delivery.push_token_id = requested.token_id");
    expect(body).toContain("RETURNING delivery.push_token_id AS token_id");
    expect(body).toContain("candidate.push_token_id");
    expect(body).not.toContain("WHERE push_token_id");
    expect(body).not.toContain("SET push_token_id");
  });

  it("infers the conflict by constraint name, which is not an expression", () => {
    expect(fixedClaim).toContain(
      "ON CONFLICT ON CONSTRAINT push_notification_deliveries_identity_unique DO NOTHING"
    );
    expect(onConflictInferenceColumns(fixedClaim)).toHaveLength(0);
  });

  it("promotes the identity index to that constraint without rebuilding it", () => {
    expect(fixedClaim).toContain(
      "UNIQUE USING INDEX push_notification_deliveries_identity_unique"
    );
    expect(fixedClaim).toMatch(/IF NOT EXISTS \([\s\S]*?FROM pg_constraint/);
  });

  it("keeps the identity key exactly as it was", () => {
    // (device, day, kind). Widening or narrowing it silently would either
    // duplicate notifications or suppress a legitimate one.
    expect(fixedClaim).not.toMatch(/DROP INDEX[\s\S]*?identity_unique/);
    expect(fixedClaim).not.toMatch(/CREATE UNIQUE INDEX[\s\S]*?identity_unique/);
  });

  it("keeps the lease semantics", () => {
    expect(fixedClaim).toContain("delivery.status IN ('pending', 'retryable_failure')");
    expect(fixedClaim).toContain("delivery.claim_expires_at <= v_now");
    expect(fixedClaim).toContain("make_interval(secs => v_ttl_seconds)");
  });

  it("drops a malformed row instead of failing the batch", () => {
    // One entry without a token id must not cost the other ninety-nine devices
    // their notification.
    expect(fixedClaim).toContain("WHERE candidate.push_token_id IS NOT NULL");
  });

  it("stays service-role only and pins its search_path", () => {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(fixedClaim, role).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.claim_push_notification_deliveries[^;]*FROM ${role}`)
      );
    }

    expect(fixedClaim).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_push_notification_deliveries[^;]*TO service_role/);
    expect(fixedClaim).toContain("SET search_path = public, pg_temp");
  });

  it("is read by the TypeScript caller under the name it has always had", () => {
    expect(store).toContain("row.push_token_id");
    expect(store).not.toContain("claimed_push_token_id");
  });

  it("so the migration and the merge can happen in either order", () => {
    // DB_NEW + MAIN_OLD and DB_OLD + MAIN_NEW both have to work, because there
    // is no instant at which a database migration and a branch merge are the
    // same event. The request field names and the response field name are the
    // whole interface, and neither side moves them.
    const claimCall = store.slice(
      store.indexOf('supabase.rpc("claim_push_notification_deliveries"'),
      store.indexOf("if (failures.length === batches.length)")
    );

    for (const field of ["p_claim_id", "p_claim_ttl_seconds", "p_rows", "push_token_id"]) {
      expect(claimCall, field).toContain(field);
    }
  });
});

describe("Friends notifications reuse this and do not grow a second system", () => {
  it("widens the kind check rather than dropping it", () => {
    expect(fixedClaim).toContain("ADD CONSTRAINT push_notification_deliveries_kind_check");

    for (const kind of ["team_invite_received", "team_member_joined", "team_edition_result"]) {
      expect(fixedClaim, kind).toContain(`'${kind}'`);
    }

    expect(fixedClaim).toContain("'edition_ready'");
  });

  it("keeps the kind in the idempotency key", () => {
    // Otherwise a Teams notification and an edition notification on the same day
    // would be the same delivery, and one would silently suppress the other.
    expect(deliveriesTable).toContain(
      "push_notification_deliveries(push_token_id, drop_date, notification_kind)"
    );
  });

  it("carries the kind through the store rather than hardcoding one", () => {
    expect(store).toContain("notification_kind: row.notificationKind");
    expect(store).toContain(".eq(\"notification_kind\", notificationKind)");
  });
});

describe("publication is the trigger, and publication is never at risk", () => {
  it("writes the event from the daily_drops publication boundary", () => {
    expect(outbox).toContain("AFTER INSERT ON public.daily_drops");
    expect(outbox).toContain("AFTER UPDATE ON public.daily_drops");
    expect(outbox).toContain("FOR EACH STATEMENT");
    expect(outbox).toContain("REFERENCING NEW TABLE AS new_rows");
  });

  it("only counts a published drop", () => {
    expect(outbox).toContain("WHERE changed.status = 'published'");
  });

  it("cannot fail the publishing transaction", () => {
    // The edition outranks its announcement. Whatever goes wrong writing the
    // event, the edition still publishes and the recovery schedules still send.
    const trigger = outbox.slice(
      outbox.indexOf("enqueue_published_edition_notification_events()\nRETURNS TRIGGER"),
      outbox.indexOf("REVOKE ALL ON FUNCTION public.enqueue_published")
    );

    expect(trigger).toContain("EXCEPTION");
    expect(trigger).toContain("WHEN OTHERS THEN");
    expect(trigger).toContain("RAISE WARNING");
    expect(trigger).not.toContain("RAISE EXCEPTION");
  });

  it("is one event per edition however many readers were written", () => {
    expect(outbox).toContain("SELECT DISTINCT changed.drop_date");
    expect(outbox).toContain("ON CONFLICT ON CONSTRAINT notification_outbox_identity_unique DO NOTHING");
    expect(outbox).toContain("notification_outbox (event_type, event_date)");
  });

  it("keeps the outbox unreadable by any client key", () => {
    expect(outbox).toContain("ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY");
    expect(outbox).not.toMatch(/CREATE POLICY[\s\S]*?notification_outbox/);
  });

  it("leases events rather than deleting them", () => {
    expect(outbox).toContain("FOR UPDATE SKIP LOCKED");
    expect(outbox).toContain("claim_expires_at");
    expect(outbox).not.toMatch(/DELETE FROM public\.notification_outbox/);
  });
});

describe("the verification boundary", () => {
  /**
   * The invariant, stated once:
   *
   *   EDITION_WRITE_ONLY             => NO_DISPATCHABLE_NOTIFICATION
   *   EDITION_WRITE_AND_VERIFY_OK    => NOTIFICATION_DISPATCHABLE
   *
   * `publish_scheduled_staging_payload` committing and
   * `verify_scheduled_edition` answering ok are two different events, in two
   * different requests, from two different projects. An edition can pass the
   * first and fail the second — that is why the verify step exists at all — and
   * a reader must never have been told about one that did.
   *
   * The behaviour is proved against a real PostgreSQL by V1–V4 in
   * push_notification_claims.test.sql. What is pinned here is that the pieces
   * are wired the way that proof assumes.
   */

  it("writes the event unverified, in the publishing transaction", () => {
    // Durable at publication time — the outbox is only worth having because the
    // event exists if and only if the edition does — and not actionable yet.
    expect(outbox).toContain("status TEXT NOT NULL DEFAULT 'awaiting_verification'");
    expect(outbox).toContain("notification_outbox (event_type, event_date, status, payload)");
    expect(outbox).toContain("'awaiting_verification',");
  });

  it("gives nothing but the release a way out of that state", () => {
    const release = outbox.slice(
      outbox.indexOf("CREATE OR REPLACE FUNCTION public.release_verified_edition_notifications"),
      outbox.indexOf("REVOKE ALL ON FUNCTION public.release_verified_edition_notifications")
    );

    expect(release).toContain("SET\n      status = 'pending'");
    expect(release).toContain("AND outbox.status = 'awaiting_verification'");
    expect(release).toContain("verified_at = v_now");

    // Every other write path in the migration leaves the state alone.
    const others = outbox.replace(release, "");
    expect(others).not.toMatch(/SET[\s\S]{0,80}status = 'pending'/);
  });

  it("cannot be claimed or dispatched before it is released", () => {
    // Both consumers select on 'pending' and neither knows the word
    // 'awaiting_verification', so an unreleased event is invisible to the whole
    // delivery path rather than merely deprioritised by it.
    expect(outbox).toContain("WHERE outbox.status = 'pending'");
    expect(dispatch).toContain("WHERE outbox.status = 'pending'");
    expect(dispatch).not.toContain("awaiting_verification");
  });

  it("releases from the production verification success, and only from there", () => {
    expect(taskPublisher).toContain('await supabase.rpc("verify_scheduled_edition"');
    expect(taskPublisher).toContain('"release_verified_edition_notifications"');
    expect(taskPublisher).toContain("verification.ok === true");

    // The release is downstream of the verify call in the same branch.
    expect(taskPublisher.indexOf('rpc("verify_scheduled_edition"')).toBeLessThan(
      taskPublisher.indexOf('"release_verified_edition_notifications"')
    );
  });

  it("never lets the notification path affect the publication verdict", () => {
    // A failed release is a notification that arrives on the fallback schedule
    // instead of within minutes. It is not an unverified edition, and it must
    // not be reported as one.
    const verifyBranch = taskPublisher.slice(
      taskPublisher.indexOf('if (action === "verify")'),
      taskPublisher.lastIndexOf('return json({ error: "unknown_action" }, 404);')
    );

    expect(verifyBranch).toContain("release_failed");
    expect(verifyBranch).not.toMatch(/releaseError[\s\S]{0,80}throw/);
  });

  it("withholds the cadence fallback for an edition it knows is unverified", () => {
    // The event path physically cannot announce an unreleased edition. The
    // fallback derives its date from the calendar instead, so without this it
    // would put the same hole back in a different pipe.
    expect(pushCli).toContain("outbox.isAwaitingVerification");
    expect(pushCli).toContain("!options.explicitDate && !options.force");
    expect(outboxClient).toContain('=== "awaiting_verification"');
  });

  it("withholds nothing when it does not know", () => {
    // No row, outbox not deployed, table unreachable: an edition with no
    // verification record behaves exactly as it did before this table existed.
    const probe = outboxClient.slice(outboxClient.indexOf("async isAwaitingVerification"));

    expect(probe).toContain("return false;");
    expect(probe).toContain("MISSING_FUNCTION_CODES");
  });
});

describe("the dispatcher", () => {
  it("wakes the sender and never sends anything itself", () => {
    expect(dispatch).toContain("net.http_post");
    expect(dispatch).not.toMatch(/exp\.host/);
    expect(dispatch).not.toMatch(/ExponentPushToken/);
  });

  it("reads its credentials from Vault and never from the file", () => {
    expect(dispatch).toContain("vault.decrypted_secrets");
    expect(dispatch).not.toMatch(/gh[ps]_[A-Za-z0-9]{10,}/);
    expect(dispatch).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{20,}/);
  });

  it("is inert rather than noisy when it is not configured", () => {
    // A cron job that raises every two minutes produces a log nobody reads and
    // no notification either.
    expect(dispatch).toContain("'not_configured'");
    expect(dispatch).not.toMatch(/RAISE EXCEPTION[\s\S]{0,200}vault/i);
  });

  it("covers 19:00 Europe/Paris under both offsets", () => {
    // pg_cron speaks UTC only: 17:00 in summer, 18:00 in winter.
    expect(dispatch).toContain("'*/2 17-22 * * *'");
  });

  it("bounds how often one event can be re-announced", () => {
    expect(dispatch).toContain("dispatched_at");
    expect(outbox).toContain("dispatched_at TIMESTAMPTZ");
  });
});

describe("the schedules are recovery, not the trigger", () => {
  it("makes the event the primary trigger of the delivery workflow", () => {
    expect(deliveryWorkflow).toContain("repository_dispatch:");
    expect(deliveryWorkflow).toContain("types: [edition_published]");
  });

  it("keeps the three Paris recovery windows", () => {
    for (const cron of ['"15 19 * * 1,3,5,0"', '"30 19 * * 1,3,5,0"', '"0 20 * * 1,3,5,0"']) {
      expect(deliveryWorkflow, cron).toContain(cron);
    }

    expect((deliveryWorkflow.match(/timezone: "Europe\/Paris"/g) ?? []).length).toBe(3);
  });

  it("never swallows a failed send", () => {
    for (const [name, workflow] of [
      ["delivery", deliveryWorkflow],
      ["daily job", dailyJobWorkflow],
      ["receipts", receiptWorkflow]
    ] as const) {
      expect(workflow, name).not.toContain("continue-on-error");
      expect(workflow, name).not.toMatch(/run:.*\|\| true/);
    }
  });

  it("replaces the health check that was reporting on a dead pipeline", () => {
    // job-health reads content_job_runs, which nothing has written since
    // publication moved into Supabase.
    expect(dailyJobWorkflow).not.toContain("content:job-health");
    expect(dailyJobWorkflow).toContain("content:notification-health:strict");
    expect(deliveryWorkflow).toContain("content:notification-health");
  });

  it("does not publish editions from CI", () => {
    for (const workflow of [dailyJobWorkflow, deliveryWorkflow, receiptWorkflow]) {
      expect(workflow).not.toContain("content:staging-publish");
      expect(workflow).not.toContain("OPENAI_API_KEY");
    }
  });
});

describe("what the sender does with the events", () => {
  it("drains the outbox and still covers today's date", () => {
    // The outbox being empty never proves nothing published.
    expect(pushCli).toContain("claimEvents");
    expect(pushCli).toContain("resolveEditionDatesToAnnounce");
    expect(outboxClient).toContain("if (input.fallbackDate)");
  });

  it("obeys an explicit --date on its own", () => {
    expect(pushCli).toContain("options.explicitDate\n    ? []");
  });

  it("degrades to no events rather than refusing to run", () => {
    expect(outboxClient).toContain("MISSING_FUNCTION_CODES");
    expect(outboxClient).toContain("return [];");
  });

  it("leaves an event pending while devices remain to retry", () => {
    expect(pushCli).toContain("result.retryable > 0 || result.bookkeepingFailures > 0");
  });

  it("exits non-zero when it cannot record what it sent", () => {
    expect(pushCli).toContain("incomplete: totals.bookkeepingFailures > 0");
    expect(read("services", "content-engine", "src", "cli.ts")).toContain(
      "if (output.incomplete) {"
    );
  });
});

describe("one bad device cannot cost every other reader their notification", () => {
  it("keeps sending when a token cannot be retired", () => {
    expect(sender).toMatch(/try \{\s*await input\.store\.disablePushToken/);
  });

  it("keeps sending when one delivery result cannot be written", () => {
    expect(sender).toContain("could not record a delivery result");
    expect(sender).toContain("result.bookkeepingFailures += 1");
  });

  it("keeps claiming when one batch is refused, and fails when every batch is", () => {
    expect(store).toContain("failures.push(");
    expect(store).toContain("if (failures.length === batches.length) {");
  });

  it("never sends a raw APNs device token to Expo", () => {
    // addPushTokenListener reports the native token — 64 hex characters on iOS —
    // and rows written by earlier builds are still in the table.
    expect(domain).toContain("function isExpoPushToken");
    expect(domain).toContain("/^Expo(nent)?PushToken\\[[^\\]]+\\]$/");
    expect(domain).toContain("invalidTokens.push(token)");
  });

  it("refuses to store one in the first place", () => {
    expect(mobilePreferences).toContain("if (!isExpoPushToken(expoPushToken))");
    expect(mobilePreferences).toContain("push_token_rejected_wrong_shape");
  });
});

describe("nothing logs a token value", () => {
  it("redacts every identifier it logs about a device", () => {
    const logCalls = [...sender.matchAll(/console\.(info|warn|error)\([\s\S]*?\}\);/g)].map(
      (match) => match[0]
    );

    for (const call of logCalls) {
      expect(call).not.toMatch(/expoPushToken/);
      expect(call).not.toMatch(/ExponentPushToken/);

      if (call.includes("push_token_id")) {
        expect(call, call.slice(0, 80)).toContain("redactIdentifier(");
      }
    }
  });

  it("keeps token values out of the mobile logs too", () => {
    expect(mobilePreferences).not.toMatch(/console\.[a-z]+\([^)]*token\.data/);
    expect(mobilePreferences).toContain("tokenStored: false");
  });
});

describe("the wording and the language", () => {
  it("is exactly the copy the product ships", () => {
    expect(domain).toContain('title: "Votre édition du jour est arrivée"');
    expect(domain).toContain('body: "Venez la découvrir dans PersoNews."');
    expect(domain).toContain('title: "Today\'s edition is here"');
    expect(domain).toContain('body: "Come discover it in PersoNews."');
  });

  it("resolves the language at send time from the profile", () => {
    // An edition published at 19:00 is never rewritten, so a reader who switched
    // to English at 19:05 must still be told in English.
    expect(store).toContain("loadCurrentUserLanguages");
    expect(store).toContain('.from("profiles")\n          .select("id,language")');
    expect(domain).toContain("input.languagesByUserId?.get(drop.userId) ?? drop.language");
  });

  it("is one notification per edition and nothing else", () => {
    expect(domain).toContain('export const EDITION_NOTIFICATION_KIND = "edition_ready"');
    expect(domain).toContain('priority: "normal" as const');
  });
});

describe("the device registration this all depends on", () => {
  it("registers against the EAS project the build is signed for", () => {
    expect(appConfig).toContain('"projectId": "30f70b52-4540-465a-88d7-c0b0b428c082"');
    expect(appConfig).toContain('"bundleIdentifier": "com.personewsap.mobile"');
    expect(mobilePreferences).toContain("Notifications.getExpoPushTokenAsync({ projectId })");
  });

  it("asks Apple before consulting the in-app preference", () => {
    // A reader cannot have opted out of a request they were never shown.
    expect(mobilePreferences).toContain("decidePushPermissionAction");
    expect(mobilePreferences).toContain("shouldEnablePreferenceAfterGrant");
  });

  it("reports a simulator as a simulator rather than as a failure", () => {
    expect(mobilePreferences).toContain('registrationState: "simulator_unsupported"');
    expect(mobilePreferences).toContain("Device.isDevice");
  });
});
