# 15-Minute Tester Script

Use this script with a small tester group. The goal is not polish feedback yet; it is to prove the core daily-drop loop works.

## Before The Tester Starts

The test coordinator should:

- Confirm the tester has the app installed or can open the Expo build.
- Confirm the tester Supabase project is configured.
- Run `npm run smoke` and, when server env is available, `npm run backend:e2e` before the tester session.
- Have a way to assign the tester a daily drop after onboarding.
- Have a feedback channel ready: form, shared doc, or direct message.
- For internal QA, set `EXPO_PUBLIC_LIVE_DATA_PROOF_MODE=true` before launching the app and watch the Metro logs.

## Minute 0-2: Create Account

1. Open PersoNewsAP.
2. Tap the signup/create-account path.
3. Enter tester email and password.
4. If email confirmation is enabled, confirm the account or ask the coordinator to confirm it.
5. Log in if the app does not sign in automatically.

Pass:

- Tester reaches onboarding.
- Errors are understandable if credentials are invalid.

## Minute 2-5: Complete Onboarding

1. Select language: EN or FR.
2. Select goal.
3. Select 2-4 topics.
4. Choose article count.
5. Choose frequency.
6. Finish onboarding.
7. Open Account and copy/send the user id to the coordinator.

Pass:

- Onboarding completes without a crash.
- Account shows onboarding as complete.
- User id is visible.

## Coordinator Step: Assign Daily Drop

After receiving the tester user id, assign a marked test drop:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
CONFIRM_PERSIST_TEST=true \
TEST_USER_ID="tester-user-id" \
npm --prefix services/content-engine run persist-test -- --date "$(date +%F)" --language en
```

Ask the tester to pull to refresh, restart the app, or switch tabs if Today was already open.

Coordinator pass signal:

- Today logs `[Today data proof]` with `event: "live_daily_drop"`.
- Library logs `[Library data proof]` with `event: "live_library_drops"`.
- Any proof-mode `mock_fallback` log is a failure for this script.

## Minute 5-9: Read Today

1. Open Today.
2. Confirm the page says `Live daily drop`.
3. Read the newsletter section.
4. Read the business story.
5. Read the mini-case.
6. Read the concept.

Pass:

- Content is readable.
- The app does not feel like an infinite feed.
- The tester can understand what to do without instruction.

## Minute 9-11: Complete, Rate, Save

1. Tap Complete on one item or module.
2. Tap Save on one item.
3. Rate one item Good, Average, or Bad.
4. Watch for visible state changes.

Pass:

- Buttons respond.
- Coordinator sees `[Content interaction proof]` with `interaction_write_success`, or a duplicate complete/save tap logs `interaction_write_skipped`.
- No crash.
- Any error message is understandable.

## Minute 11-13: Check Library

1. Open Library.
2. Confirm the daily drop appears.
3. Confirm completed/saved state appears where relevant.
4. Open or inspect an item if the UI allows it.

Pass:

- Library is not empty for the assigned tester.
- Saved/completed indicators make sense.

## Minute 13-15: Logout And Login

1. Open Account.
2. Log out.
3. Log back in with the same account.
4. Open Today.
5. Open Library.

Pass:

- Session flow works.
- Today and Library still load after login.

## Tester Feedback Prompts

Ask the tester:

- Where did you hesitate?
- Did anything look broken or fake?
- Was the daily drop useful in under five minutes?
- Did the app feel finite, or did it feel like a feed?
- Which content module was most useful?
- What would stop you from using this tomorrow?

## Coordinator Notes To Capture

- Tester email or anonymous tester id.
- Device and OS version.
- Language selected.
- Topics selected.
- Whether Today was live or preview.
- Whether proof mode was enabled.
- Any screenshot or screen recording.
- Any Metro proof log if running locally:
  - `[Profile proof]`
  - `[Onboarding proof]`
  - `[Today data proof]`
  - `[Library data proof]`
  - `[Content interaction proof]`
