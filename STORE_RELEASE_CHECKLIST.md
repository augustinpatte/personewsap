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

- [ ] Deploy the account-deletion Edge Function. It is written and reviewed —
      see `supabase/functions/delete-account/` — and only needs deploying:
      `supabase functions deploy delete-account --project-ref <ref>`.
      Then set its URL as `EXPO_PUBLIC_ACCOUNT_DELETION_ENDPOINT` (EAS build
      env) and `VITE_ACCOUNT_DELETION_ENDPOINT` (web env). Until then both the
      app and /delete-account say deletion is not enabled rather than failing.
- [ ] Set `ACCOUNT_DELETION_ALLOWED_ORIGINS` on the function to the public web
      origin, so the browser page can call it:
      `supabase secrets set ACCOUNT_DELETION_ALLOWED_ORIGINS="https://<domain>"`.
- [ ] Verify the two curl checks in
      `supabase/functions/delete-account/README.md` both answer 401 before
      testing a real deletion with a throwaway account.
- [ ] Verify the production project has only the checked-in migrations applied
      (`npx supabase migration list` against the linked project).
- [ ] Confirm the daily content job (content-engine) runs on the 4×/week
      cadence with production env vars (no test flags).
- [ ] Merge `.github/workflows/content-daily-job.yml` to `main`: a scheduled
      workflow never fires from a feature branch. Set the repository secrets it
      reads (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`,
      `ANTHROPIC_API_KEY`).

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
