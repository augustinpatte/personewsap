# STORE_RELEASE_CHECKLIST

Manual actions only. Everything automatable is already done in the repo
(app.json, eas.json, npm scripts, mock gating, account deletion UI, FR/EN).
Owner: Apple Developer / App Store Connect / Google Play Console / Supabase /
EAS account holder.

Everything in code is ready to receive these values; nothing here can be done
from the repository. See KNOWN_ISSUES.md for what is still open.

Current app config: `com.personewsap.mobile`, version `1.0.0`,
iOS buildNumber `1`, Android versionCode `1`, `supportsTablet: false`,
Expo SDK 55 (targets Android API 36, builds with the iOS 26 SDK on EAS's
current Xcode image).

Verified 2026-08-25: `npx expo-doctor` 20/20, `npx expo install --check` clean,
root suite 1262 tests green, mobile `tsc --noEmit` clean, `eslint` 0 errors,
`supabase:doctor --live` 157 pass / 0 fail against production.

## Apple Developer

- [ ] Confirm the paid Apple Developer membership is active.
- [ ] Create (or let EAS create) the App ID `com.personewsap.mobile` with the
      Push Notifications capability.
- [ ] Create an APNs key (or let EAS manage it) so expo-notifications can
      deliver on iOS.

## App Store Connect

- [ ] Create the app record for `com.personewsap.mobile` (name: PersoNewsAP).
- [ ] App Privacy questionnaire ("Data Safety" equivalent): declare email,
      user content interactions and push tokens; all linked to the account;
      no tracking, no third-party ads.
- [ ] Add the Support URL and Privacy Policy URL. Both are now public web
      routes: `/privacy` and `/support` (plus `/delete-account`). Set
      `VITE_SUPPORT_EMAIL` before submitting — until it is set, /support says
      no address is configured rather than showing a fake one.
- [ ] Screenshots for 6.7" and 6.1" iPhones (4 tabs: Newsletter, Mini cases,
      Stories, Parcours + a reader).
- [ ] Confirm "Account deletion" review requirement: the in-app path is
      Account → Delete account. Set `EXPO_PUBLIC_ACCOUNT_DELETION_ENDPOINT`
      (see Supabase section) before the production build so the button works.
- [ ] Age rating questionnaire (news/education, no user-generated content).
- [ ] After the EAS build: submit to TestFlight, run the 15-min tester script
      (TESTER_SCRIPT_15_MIN.md), then submit for review.

## Google Play Console

- [ ] Create the app (`com.personewsap.mobile`), accept the developer
      declarations (target API 36 is already satisfied by SDK 55).
- [ ] Data Safety form: email, in-app interactions, push token; encrypted in
      transit; deletion available in-app and from the web.
- [ ] Upload the privacy policy URL (`/privacy`) and the external account
      deletion URL (`/delete-account`), which Play asks for separately.
- [ ] Store listing: screenshots (phone), feature graphic, descriptions FR/EN.
- [ ] Create a service account JSON key for Play submissions and store it
      OUTSIDE git; reference it when running
      `npm --prefix apps/mobile run submit:android:production`
      (eas submit will prompt for the key path on first run).
- [ ] First upload must be done manually once (Play requires the first AAB via
      the Console or an authorized key), track `internal`.

## Supabase

- [ ] Set the deployed function URL as `EXPO_PUBLIC_ACCOUNT_DELETION_ENDPOINT`
      (EAS production build env) and `VITE_ACCOUNT_DELETION_ENDPOINT` (web env):
      `https://wkbviidrbmehmjbhvpeh.supabase.co/functions/v1/delete-account`.
      Until they are set, both the app and /delete-account say deletion is not
      enabled rather than failing.
- [ ] Test one real deletion with a throwaway account before submitting.
- [x] Deploy the account-deletion Edge Function — **done**. `delete-account` is
      ACTIVE on `wkbviidrbmehmjbhvpeh` (version 2, `verify_jwt: true`), and the
      deployed bundle matches `supabase/functions/delete-account/index.ts`.
      Both unauthenticated probes answer 401.
- [x] Verify the production project has only the checked-in migrations applied
      — **done**. All 32 migrations match local↔remote. Two migrations had been
      applied directly in the dashboard and were missing from git; they are now
      checked in (`20260822184440`, `20260822184715`).
- [ ] Set `ACCOUNT_DELETION_ALLOWED_ORIGINS` on the function. It is **not set**
      today, so `Access-Control-Allow-Origin` comes back empty and the web
      `/delete-account` page cannot call the function from a browser. The
      mobile app is unaffected (it sends no `Origin`), but Google Play requires
      the *external* web deletion URL to work:
      `supabase secrets set ACCOUNT_DELETION_ALLOWED_ORIGINS="https://<domain>"`.
- [ ] Confirm the daily content job (content-engine) runs on the 4×/week
      cadence with production env vars (no test flags).

## GitHub Actions

Scheduled workflows only fire from the default branch. `.github/workflows/` is
now on `main`, so the four editorial-day schedules are live — and they will fail
on every run until the secrets below exist. **The repository currently has no
secrets configured at all** (neither repository-level nor in the `Preview` /
`Production` environments).

Set exactly these four, and only these four:

- [ ] `SUPABASE_URL` — production project URL.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — production service-role key (rotated; see
      SECURITY below).
- [ ] `STAGING_SUPABASE_URL` — ChatGPT staging project URL.
- [ ] `STAGING_SUPABASE_SERVICE_ROLE_KEY` — staging service-role key.

`OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are **not** used by any workflow and
must not be set as CI secrets. Editorial generation happens in ChatGPT
Scheduled Tasks before the workflow runs; `content-daily-job.yml` only reads the
approved staging batch and publishes it. There is deliberately no automatic
fallback to a paid API. Those two keys are needed solely for the manual
`npm run content:legacy-api-run` path, from an operator machine.

## SECURITY — do this before anything else

- [ ] **Rotate the Supabase service-role key** for `wkbviidrbmehmjbhvpeh`. The
      key currently in use was committed to this repository in `d91aee1` and
      `56045d0`, removed in `d273ae2`, and remains reachable in the published
      history of a **public** GitHub repository. A service-role key bypasses
      every RLS policy.
- [ ] **Rotate the Resend API key** (`re_Vg…`), leaked in the same commits.
- [ ] After rotating, update: `services/content-engine/.env`, `.env.python`,
      the four GitHub secrets above, and the Supabase Function secrets.
- [ ] Consider whether the repository should be public at all before launch.

See KNOWN_ISSUES.md → "Leaked Production Credentials In Git History".

## EAS

- [ ] `eas login` + `eas init` to bind the project (sets `extra.eas.projectId`
      / `EXPO_PUBLIC_EAS_PROJECT_ID`, required for push tokens).
- [ ] Set build-profile env vars for production: `EXPO_PUBLIC_SUPABASE_URL`,
      `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_ACCOUNT_DELETION_ENDPOINT`
      (and analytics endpoint if used). Never the service-role key.
- [ ] Run `npm --prefix apps/mobile run build:ios:production` and
      `npm --prefix apps/mobile run build:android:production`, letting EAS
      manage credentials (App Store key, Android keystore).
- [ ] Keep the generated Android keystore backed up (EAS-managed is fine).
