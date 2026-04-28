# TestFlight Readiness

This is the checklist for moving from local/simulator tester prep to an installable TestFlight build.

## Must Be Done Before TestFlight

- Confirm the Apple Developer account, App Store Connect app record, bundle identifier, signing certificates, and provisioning are ready.
- Decide the tester Supabase project and apply all migrations.
- Configure only public mobile env vars in the build:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Use `EXPO_PUBLIC_LIVE_DATA_PROOF_MODE=true` only for internal proof builds. Set it back to `false` or omit it for tester builds unless the coordinator is actively watching console logs.
- Confirm no service role, OpenAI, Resend, or private generation key is present in the mobile build, repo, screenshots, or logs.
- Run `npm run smoke` from the repo root.
- Run [SUPABASE_CHECKLIST.md](SUPABASE_CHECKLIST.md) against the tester project.
- Run a full live-data proof on a simulator or physical device:
  - sign up
  - onboarding
  - assigned live daily drop
  - complete/save/rate interaction
  - Library
  - logout/login
- Prepare tester instructions using [TESTER_SCRIPT_15_MIN.md](TESTER_SCRIPT_15_MIN.md).
- Share known limitations from [KNOWN_ISSUES.md](KNOWN_ISSUES.md) with the tester coordinator.
- Review App Store privacy nutrition labels and data collection statements against actual Supabase/auth/interaction data.
- Confirm support contact, feedback channel, and tester invite list.

## Must Be True In The App

- Today clearly shows whether the user is in `Live daily drop` or preview mode.
- Proof-mode mock fallback logs are treated as QA failures, not as successful live-data proof.
- Empty states are readable and do not look broken.
- Auth errors are human-readable.
- Onboarding can be completed without developer intervention.
- Account screen exposes the tester user id for assignment during the controlled test.
- Logout and login return the tester to the correct state.
- No screen exposes raw secrets, service-role data, or internal stack traces.

## Can Wait Until After First Small Test

- Automated production scheduler.
- Editorial review dashboard.
- Push notifications.
- In-app tester feedback form, if an external form is used.
- Analytics instrumentation beyond manual QA notes.
- Full App Store marketing page polish.
- Broad Android release process.
- Production cleanup automation for published test rows.
- More advanced personalization beyond current preferences and assignment.

## Manual QA Checklist

### Build And Config

- `npm run smoke` passes.
- Mobile app builds/runs with the intended Supabase project.
- `apps/mobile/.env` contains only public keys.
- Tester project has migrations applied.
- Email confirmation behavior is known and documented for testers.

### Account And Onboarding

- New account signup works.
- Existing account login works.
- Invalid password shows a readable error.
- Onboarding saves language, goal, topics, article count, and frequency.
- Account shows onboarding as complete.
- Account shows the tester user id.

### Daily Drop

- Assigned user sees `Live daily drop`.
- Unassigned user sees a readable preview/empty state.
- Newsletter renders.
- Business story renders.
- Mini-case renders.
- Concept renders.
- Source links/titles are visible where expected.
- Progress state updates after completing modules.

### Interactions

- Complete writes successfully.
- Save writes successfully.
- Good/Average/Bad rating writes successfully.
- Repeat complete/save taps either skip duplicate writes or stay stable.
- Changing a rating creates a new latest rating without breaking the item state.
- Failed write shows a readable error and the app stays usable.

### Library

- Library loads assigned drops.
- Saved/completed indicators appear when relevant.
- Empty Library state is readable.
- Switching tabs does not lose session state.

### Session

- Logout works.
- Login after logout restores access.
- Restarting the app preserves the session when expected.
- Expired or missing session returns to auth/onboarding without a blank screen.

### Device Pass

- iPhone small viewport.
- iPhone large viewport.
- Dark/light mode if supported by the simulator/device.
- Slow network or airplane-mode spot check.

## TestFlight Stop Conditions

Do not invite testers if any of these are true:

- A secret is present in the mobile app or committed files.
- A new tester cannot complete onboarding.
- Live daily drops cannot be assigned and loaded.
- Proof mode logs `mock_fallback` during the live-data proof.
- Complete/save/rating interactions fail for live content.
- Logout/login breaks the account.
- The app crashes during the 15-minute tester script.
- Known production risks have not been shared with the tester coordinator.
