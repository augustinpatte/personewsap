# Reader-local notifications

An edition can cause at most two push notifications for a reader, both on the
reader's own clock:

| Kind | When | Only if |
| --- | --- | --- |
| `edition_ready` | 20:00 reader-local on the edition date, or the moment the edition is ready if later | the edition is verified |
| `edition_answer_reminder` | 08:30 reader-local the next morning, once | assigned questions are still unanswered |

Each notification gets **at most three attempts**: the initial one, a retry at
+15 minutes and a retry at +30 minutes (20:00 / 20:15 / 20:30, 08:30 / 08:45 /
09:00). These are technical retries, not three notifications. Once Expo has
accepted a ticket, the notification is never sent again.

Team notification kinds (`team_invite_received`, `team_member_joined`,
`team_edition_result`) are not scheduled by any of this. Nothing in the
repository sends them yet; when something does, it uses the same delivery
table and is not gated on a local time.

Migrations:

- `supabase/migrations/20260910090000_reader_local_notifications.sql`: the
  reader's clock, the reminder's eligibility, and health.
- `supabase/migrations/20260912090000_push_timing_and_retries.sql`: 20:00
  instead of 19:00, the retry schedule, the attempt cap, observability, and the
  Supabase worker.

## What went wrong on 11–12 September

- **Evening.** The 2026-09-11 edition was verified at 17:00:19Z (12:00 Chicago),
  and the Chicago reader was due at 19:00 Chicago (00:00Z). The delivery row was
  written at 01:27:20Z (20:27 Chicago) and the ticket accepted a second later.
  The edition was not late. Between 23:09Z and 01:26Z the `*/30` GitHub schedule
  did not run at all. The push then left with APNs priority 5 (`"normal"`),
  which lets iOS hold it, and it reached the phone around 20:39.
- **Morning.** The reminder was due at 08:30 Chicago (13:30Z). The database
  dispatcher fired (`notification_dispatch_state` shows it), but none of the 43
  recorded runs was started by `repository_dispatch`. The next scheduled run
  started at 14:19:29Z and sent at 14:19:56Z (09:19 Chicago).
- **The schedule.** The workflow's schedule was `*/30 * * * *`, not
  `17 * * * *`. GitHub ran it only every three to five hours (01:26, 06:24,
  11:10, 14:19 and 17:24 UTC on the 12th).

The fix is to stop depending on GitHub's scheduler for the time of day.

## The clock

`profiles.timezone` (an IANA name) is the only authority. The app writes it when
the profile is created and again whenever the device's zone changes
(`useProfileTimezoneSync`, on launch and on every return to the foreground).

The zone is read from the OS through `expo-localization`
(`getCalendars()[0].timeZone`), not from the JavaScript engine's `Intl` zone. It
falls back to `Intl` only if the native value is unavailable.

Every due time is computed by PostgreSQL's tz database
(`(day + time) AT TIME ZONE zone`), so DST is resolved by the zone rules. The
server's own timezone plays no part. A missing, unknown or non-IANA value
(`Mars/Olympus`, `UTC+5`, `CEST`) is treated as `Europe/Paris`. `UTC` is
accepted as-is, since it is the column default of old rows.

- `edition_ready_target_at` is 20:00 local on the edition date.
- `edition_ready_due_at` is `greatest(20:00 local, verified_at)`. An unverified
  edition is never due, and the time is never moved to another day.
- `edition_answer_reminder_target_at` is 08:30 local on the next calendar day.
  `edition_answer_reminder_due_at` adds "never before that reader's
  `edition_ready`". The reminder can be sent until 11:30 local and never later.

Edition Monday 2026-09-14, verified 17:05Z:

| Reader | edition_ready | reminder |
| --- | --- | --- |
| Europe/Paris | 20:00 Paris (18:00Z) | Tue 08:30 Paris (06:30Z) |
| Europe/London | 20:00 London (19:00Z) | Tue 08:30 London (07:30Z) |
| America/Chicago | 20:00 Chicago (Tue 01:00Z) | Tue 08:30 Chicago (13:30Z) |
| Asia/Tokyo | at verification: 02:05 Tokyo (17:05Z), its 20:00 had passed | Tue 08:30 Tokyo (Mon 23:30Z) |
| Australia/Sydney | at verification (17:05Z), its 20:00 had passed | Tue 08:30 Sydney (Mon 22:30Z) |

DST examples, proven in `supabase/tests/push_timing_and_retries.test.sql`:

| Case | 20:00 | 08:30 next morning |
| --- | --- | --- |
| Chicago, Sat 2026-10-31 (CDT) → Sun 2026-11-01 (CST) | 01:00Z | 14:30Z |
| Chicago, Sun 2026-11-01 (CST) | 02:00Z | — |
| London, Sat 2026-10-24 (BST) → Sun 2026-10-25 (GMT) | 19:00Z, then 20:00Z | — |
| Sydney, Sat 2026-10-03 (AEST) → Sun 2026-10-04 (AEDT) | 10:00Z | 21:30Z |

**Travel.** Nothing about a zone is frozen into the schedule before it is due,
so the zone at that time decides. A delivery row records the zone it was
scheduled in (`reader_timezone`), for the record only.

## Who does the sending

- **The primary worker is in Supabase.** pg_cron runs
  `public.invoke_push_worker()` every minute (job `personews-push-worker`).
  When `count_claimable_push_work()` finds something due, it POSTs to the Edge
  Function `personews-push-notifications`. It never makes a request when
  nothing is due.
- **The Edge Function claims and records only.** It calls
  `claim_due_push_notifications`, sends exactly the rows it was handed to Expo,
  and records each outcome with `record_push_delivery_attempt`.
- **The GitHub workflow is the fallback.**
  `.github/workflows/push-notification-retry.yml` runs every five minutes, plus
  on `repository_dispatch` and the three Paris evening windows. It runs
  `content:push-notifications` against the same SQL claims, so both workers can
  run at once without a duplicate. It also reconciles receipts.

Supabase is the authority on everything: `scheduled_for`, attempts, the next
retry slot, idempotency.

## Retries and idempotency

The unique key is `(push_token_id, drop_date, notification_kind)`: one row per
device, edition and kind.

**Leasing counts the attempt.** `attempt_count` goes up by one and
`next_attempt_at` is set to `scheduled_for + 15 min × attempts`.

**A retryable failure** (network error, Expo 5xx or 429, an Expo ticket error
worth retrying) is set to that slot by a trigger (`schedule_push_delivery_retry`).
A worker that dies after leasing leaves the same slot behind, because its lease
(at most 14 minutes) expires before the slot arrives. For example, with a 20:00
Chicago target:

| Attempt | When | On failure |
| --- | --- | --- |
| 1 | 20:00 | retry at 20:15 |
| 2 | 20:15 | retry at 20:30 |
| 3 | 20:30 | `terminal_failure: gave up after 3 attempts` |

The morning reminder follows 08:30, 08:45 and 09:00 the same way. Retries count
from `scheduled_for`, the first moment the row could be sent: an edition ready
at 20:27 retries at 20:42 and 20:57.

**The states:**

| State | Meaning | Leased again? |
| --- | --- | --- |
| `pending` | written, not yet attempted | yes, at `scheduled_for` |
| `claimed` | leased by a worker | only after the lease expires, at the next slot |
| `retryable_failure` | failed before Expo accepted it | yes, at `next_attempt_at` |
| `awaiting_receipt` | Expo accepted the ticket, receipt not read yet | **never** |
| `sent` | receipt says delivered | **never** |
| `terminal_failure` | permanent error, invalid token, three attempts used, or send window over | **never** |
| `cancelled` | no longer owed (answered, notifications off, device retired) | **never** |

A retryable receipt stays `awaiting_receipt`. A receipt never causes a resend.

**Guards:**

- Nothing is sent more than three hours after `scheduled_for`.
- No row gets a fourth attempt, even if it is forced back to `pending`.
- A worker whose lease was taken over (`stale_claim`) records nothing.
- The sender on `main`, which still adds one to `attempt_count` itself, is
  neutralised by the trigger, so an attempt is never counted twice.

## When the edition is not ready at 20:00

Nothing is sent and nothing is written. The row is created, with
`target_at = 20:00 local` and `scheduled_for = edition_ready_at`, the minute
the edition is verified, and sent in that same minute.
`get_push_delivery_timeline(date)` then shows `blocked_until_ready = true`
alongside the local target, its UTC instant, the ready time and every attempt.

## Who is reminded

`edition_answer_reminder_reader(user, edition, now)` is the only definition. It
is unchanged by 20260912090000. A reader is owed a reminder only if all of the
following hold at claim time:

- the edition was verified;
- the reader was assigned at least one question;
- at least one of those questions is still unanswered;
- notifications are on;
- a live device exists;
- the edition is still open;
- it is between 08:30 and 11:30 local;
- the reader has not been reminded yet.

It is re-evaluated in the statement that leases each attempt, including the
retries. A reader who answers between 08:30 and 08:45 is stood down
(`cancelled: completed_before_send`), never reminded.

## Observability

Each attempt in the Edge Function logs one JSON line (`event: push_attempt`)
with these fields:

- `kind`, `drop_date`, `timezone`
- `target_local_time`, `target_utc`
- `edition_ready_at`, `blocked_until_ready`, `scheduled_for`
- `actual_dispatch_at`, `attempt_number`
- `result`, `recorded_status`, `retry_due_at`

The line identifies a device by the first 8 characters of its row id only.
Push tokens and user ids are never logged.

`select * from get_push_delivery_timeline('2026-09-14')`, run with the service
role, returns the same information per delivery row, with hashed reader ids and
no tokens.

`npm run content:notification-health` still reports `scheduled_not_due`,
`due_awaiting_worker` and `never_attempted` per reader, now against the 20:00
target.

## Deploying

Nothing here deploys itself. In order:

1. **Prove it locally:**
   `node scripts/local-sql-tests.mjs push-timing local-time push --with-migrations`.
2. **Apply the migration:** `supabase db push` on the production project.
   Everything it contains is additive. Rows that already exist get
   `scheduled_for = created_at`, so days-old retryable rows are retired, never
   sent. The minute job is inert until step 4.
3. **Deploy the function and its token:**
   - `supabase functions deploy personews-push-notifications --project-ref wkbviidrbmehmjbhvpeh --no-verify-jwt`
   - `supabase secrets set PERSONEWS_PUSH_WORKER_TOKEN=<random> --project-ref wkbviidrbmehmjbhvpeh`
4. **Add the two Vault secrets** (SQL editor):
   - `select vault.create_secret('https://wkbviidrbmehmjbhvpeh.supabase.co/functions/v1/personews-push-notifications', 'personews_push_worker_url');`
   - `select vault.create_secret('<same random>', 'personews_push_worker_token');`
5. **Merge the branch.** Scheduled workflows only run from `main`, and the
   five-minute fallback and the Node sender's changes take effect then. The
   order of steps 2 and 5 doesn't matter: every function keeps its signature,
   and the trigger absorbs the old sender's own attempt counting.
6. **Check it:**
   - `select public.invoke_push_worker();` returns `no_due_work` outside due
     minutes.
   - `select * from net._http_response order by created desc limit 5;` shows
     the function answering 200.
   - Look at `get_push_delivery_timeline(<date>)` after 20:00.

Separately from this change, the old dispatcher's `repository_dispatch` never
started a GitHub run. Check `personews_notification_dispatch_token` (it needs
Contents: write on the repository) and `net._http_response`. With the Supabase
worker in place this no longer affects timing.

**Rollback:** `select cron.unschedule('personews-push-worker');` stops the
Supabase worker. The GitHub fallback keeps sending on the same rules.
