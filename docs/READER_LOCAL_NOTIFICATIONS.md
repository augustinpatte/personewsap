# Reader-local notifications

An edition can cause at most two push notifications for a reader, both on the
reader's own clock:

| Kind | When | Only if |
| --- | --- | --- |
| `edition_ready` | ~19:00 reader-local on the edition date | the edition is verified |
| `edition_answer_reminder` | ~08:30 reader-local the next morning, once | assigned questions are still unanswered |

Team notification kinds (`team_invite_received`, `team_member_joined`,
`team_edition_result`) are not scheduled by any of this. Nothing in the
repository sends them yet; when something does, it uses the same delivery
table and is not gated on a local time.

Migration: `supabase/migrations/20260910090000_reader_local_notifications.sql`.

## The clock

`profiles.timezone` (an IANA name) is the only authority. The app writes it
when the profile is created and again whenever the device's zone changes
(`useProfileTimezoneSync`, on launch and on every return to the foreground).

The zone is read from the OS through `expo-localization`
(`getCalendars()[0].timeZone`), not from the JavaScript engine's `Intl` zone. It
falls back to `Intl` only if the native value is unavailable.
`expo-localization` is a native module, so this needs a new native build
(TestFlight).

Every due time is computed **when it is asked**, by PostgreSQL's tz database
(`(day + time) AT TIME ZONE zone`). No offset is stored, and DST is resolved by
the zone rules. An unknown or non-IANA value (`Mars/Olympus`, `UTC+5`, `CEST`)
is treated as `Europe/Paris`.

- `edition_ready_due_at` = `greatest(edition_date 19:00 local, verified_at)`.
  If the reader's 19:00 is still ahead when the edition verifies (everyone west
  of Paris), they are told at 19:00. If it has already passed (Shanghai, Tokyo),
  they are eligible immediately at verification. It is never moved to another
  day.
- `edition_answer_reminder_due_at`: 08:30 local on the calendar day after the
  edition date, never before that reader's `edition_ready`. It can be sent until
  11:30 local and never later.

Edition Monday 2026-09-14, verified 17:05Z (19:05 Paris):

| Reader | edition_ready | reminder |
| --- | --- | --- |
| Europe/Paris | 19:05 Paris (17:05Z) | Tue 08:30 Paris (06:30Z) |
| America/New_York | 19:00 NY (23:00Z) | Tue 08:30 NY (12:30Z) |
| America/Chicago (New Orleans) | 19:00 Chicago (Tue 00:00Z) | Tue 08:30 Chicago (13:30Z) |
| America/Los_Angeles | 19:00 LA (Tue 02:00Z) | Tue 08:30 LA (15:30Z) |
| Asia/Shanghai | at verification: Tue 01:05 Shanghai (17:05Z), its 19:00 had passed | Tue 08:30 Shanghai (00:30Z) |

DST examples:

- Chicago, Friday 2026-10-30 (CDT): 19:00 = 00:00Z, and the reminder at 08:30 = 13:30Z.
- Chicago, Sunday 2026-11-01, after the fall-back: 19:00 = 01:00Z, and the reminder at 08:30 = 14:30Z.

All of these are proven in `supabase/tests/reader_local_notifications.test.sql`.

**Travel.** Nothing about a zone is frozen into a schedule row, so the zone at
send time decides. A reader due at 08:30 Paris who lands in Chicago and opens
the app before then is reminded at 08:30 Chicago instead. The same applies to
19:00. If they don't open the app, the server keeps using the last zone it knew.

## Who is reminded

`edition_answer_reminder_reader(user, edition, now)` is the only definition. The
claim, the dispatcher's probe and the health report all read it. A reader is
owed a reminder only if **all** of the following hold at claim time:

- **Verified:** the edition was verified. For editions that predate the outbox,
  the publication time counts as verification.
- **Assigned:** the reader was assigned at least one question. That means
  personal `solo_question_assignments`, or questions of an active Team they are
  currently eligible in for that edition.
- **Unanswered:** at least one of those questions has no submitted `question_attempts` row.
- **Notifications on:** `user_preferences.notifications_enabled` is true.
- **Device:** at least one enabled, well-formed Expo push token exists.
- **Edition open:** `is_edition_open`, meaning the next edition hasn't published yet.
- **Window:** it is between 08:30 and 11:30 local.
- **Not yet reminded:** no reminder row exists yet for that reader and edition.

`claim_edition_answer_reminders` re-evaluates this inside the statement that
leases the delivery row, then returns only what may be sent:

- **Newly owed:** a newly owed reader is fanned out to their live devices once.
  A device registered afterwards does not get a second reminder.
- **No longer owed:** a fanned-out row that is no longer owed becomes `cancelled`
  with reason `completed_before_send`, `notifications_disabled` or
  `edition_closed`. This is not a failure.
- **Window closed:** a row still unsent at 11:30 local becomes
  `terminal_failure: reminder send window elapsed`, so there is no afternoon nag.

**Completion suppresses immediately.** Nothing is scheduled that needs
cancelling. The reminder exists only while a question is unanswered, so the
answer committing is what removes it. The only remaining window is the
milliseconds between the claim and the Expo request.

**Idempotency is per device, not per account.** The unique key is
`(push_token_id, drop_date, notification_kind)`. That guarantees:

- at most one `edition_ready` delivery per device per edition;
- at most one `edition_answer_reminder` delivery per device per edition.

A reader with two active devices therefore receives each push on both. There is
no account-level exactly-once guarantee. The one account-level rule is on the
reminder fan-out: it happens once per reader and edition, to the devices active
at that moment. A device registered after the reminder went out gets none,
while a device registered before its 19:00 does get `edition_ready`.

## Who wakes the sender

`dispatch_notification_events` (pg_cron, `*/2 * * * *`, one job) now also calls
`count_due_edition_notifications()`. When a reader-local notification has come
due and was never attempted, it sends `repository_dispatch:
edition_notifications_due`, at most once every 5 minutes (throttled by
`notification_dispatch_state`).

`push-notification-retry.yml` runs `content:push-notifications`. That command
works out who is due right now across every reader:

- editions from the outbox, today's cadence date, and every edition verified
  in the last three days (each gated per reader by `get_edition_ready_schedule`);
- then `claim_edition_answer_reminders`.

A `*/30 * * * *` schedule is the recovery path if the dispatcher cannot reach
GitHub. `push-receipts.yml` also runs every 3 hours, because reminders are sent
at every hour.

## Health

`npm run content:notification-health` now reports three things:

- **`edition_ready` for the latest edition:**
  - `scheduled_not_due`: this reader's 19:00 hasn't come yet. Healthy.
  - `due_awaiting_worker`: due in the last 30 minutes. Healthy.
  - `never_attempted`: due more than 30 minutes ago, or the edition was never
    verified. **Critical.**
- **The reminder, for the two latest editions,** counted in readers. The
  `summary` field is one of:
  - `no_reminder_needed`
  - `scheduled` (with `nextDueAt`)
  - `due`
  - `sent`
  - `failed`, which means `never_attempted > 0` and is **critical**
  - `not_released`
- **Supporting counts** alongside that: `completedBeforeReminder`, `cancelled`,
  `notEligible`, `editionClosed`, `retryable` (a warning) and `terminal`.

## Deploying

1. The migration depends on the Teams/scored-questions migrations
   (`solo_question_assignments`, `team_*`, `editions`, `question_attempts`).
   Deploy it after them, as a plain forward `supabase db push`.
2. Prove it locally first: `npm run local-time:test:sql:local`, then
   `node scripts/local-sql-tests.mjs push --with-migrations`.
3. Sender order doesn't matter. A sender without the migration behaves as before
   (`localTimeGate: "unavailable"`, reminders `deployed: false`). A database with
   the migration and an old sender keeps announcing at verification time.
4. The Vault secrets `personews_notification_dispatch_url` and
   `personews_notification_dispatch_token` make reader-local delivery punctual.
   Without them, the half-hourly schedule delivers within about 30 minutes.
5. Scheduled workflows only run from `main`.

**Rollback:** re-schedule the cron to `'*/2 17-22 * * *'` to stop reader-local
wake-ups. Every function is additive, and the sender falls back to announcing
at verification if the schedule RPC is removed.
