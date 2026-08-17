# STORE_RELEASE_CHECKLIST

Manual actions only. Everything automatable is already done in the repo
(app.json, eas.json, npm scripts, mock gating, account deletion UI, FR/EN).
Owner: Apple Developer / App Store Connect / Google Play Console / Supabase /
EAS account holder.

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
- [ ] Add the Support URL and Privacy Policy URL (the in-app policy exists at
      the `/privacy` route; it must also be hosted at a public HTTPS URL).
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
      transit; deletion available via in-app request.
- [ ] Upload the privacy policy URL.
- [ ] Store listing: screenshots (phone), feature graphic, descriptions FR/EN.
- [ ] Create a service account JSON key for Play submissions and store it
      OUTSIDE git; reference it when running
      `npm --prefix apps/mobile run submit:android:production`
      (eas submit will prompt for the key path on first run).
- [ ] First upload must be done manually once (Play requires the first AAB via
      the Console or an authorized key), track `internal`.

## Supabase

- [ ] Deploy a server-side account-deletion endpoint (Edge Function with the
      service-role key) that deletes the auth user + rows in profiles,
      user_preferences, topic preferences, content_interactions,
      mini_case_responses, push_tokens, daily_drops for the JWT's user, then
      set its URL as `EXPO_PUBLIC_ACCOUNT_DELETION_ENDPOINT` in the EAS build
      env. Until then the app shows an honest "deletion requests not enabled"
      message.
- [ ] Verify the production project has only the checked-in migrations applied
      (`npx supabase migration list` against the linked project).
- [ ] Confirm the daily content job (content-engine) runs on the 4×/week
      cadence with production env vars (no test flags).

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
