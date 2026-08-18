# PersoNewsAP Mobile

Initial Expo React Native skeleton for the PersoNewsAP iOS/Android migration.

This mobile app is additive. It does not replace the existing Vite web app, newsletter dispatch script, JSON newsletter format, or production newsletter tables.

## Stack

- Expo SDK 55
- React Native
- TypeScript
- Expo Router
- Supabase client configured for React Native storage

## Setup

```sh
cd apps/mobile
npm install
cp .env.example .env
npm run start
```

Then open the app in Expo Go, an iOS simulator, an Android emulator, or a
development build.

Expo Go is useful for UI and auth checks, but it is not a TestFlight proof.
Push notification registration needs a development build or a TestFlight build
with EAS project metadata and native notification credentials. Expo Go should
not be used to validate push opt-in, push token storage, or App Store readiness.

## Environment

Use public client environment variables only:

```sh
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_EAS_PROJECT_ID=
EXPO_PUBLIC_ACCOUNT_DELETION_ENDPOINT=
EXPO_PUBLIC_SUPPORT_EMAIL=
```

Do not put service role keys, Resend keys, generation secrets, or production-only credentials in this app.

`EXPO_PUBLIC_EAS_PROJECT_ID` is optional for normal local development, but a real EAS project id is required before a physical device can register an Expo push token. A production push proof must use a development build or TestFlight build, not Expo Go, with APNs/FCM credentials configured in the Expo/EAS project.

## Analytics

Product analytics are routed through `src/lib/analytics.ts`. If no analytics
endpoint and public write key are configured, events no-op silently and the app
continues normally.

Optional Expo variables:

```sh
EXPO_PUBLIC_ANALYTICS_PROVIDER=
EXPO_PUBLIC_ANALYTICS_ENDPOINT=
EXPO_PUBLIC_ANALYTICS_WRITE_KEY=
EXPO_PUBLIC_ANALYTICS_DEBUG=false
```

The built-in provider sends a small generic HTTP POST with `event`,
`properties`, `sent_at`, and `source: "mobile"`. Configure the endpoint as an
analytics proxy or vendor ingestion URL that accepts client-side public keys.
Only safe product metadata is allowed: language, topic, content type, drop date,
and content item id already shown to the user. Do not send email, user id,
profile fields, free text, source URLs, secrets, or authentication tokens.

## Useful Commands

```sh
npm run start
npm run ios
npm run android
npm run config:public
npm run build:ios:preview
npm run typecheck
```

## Current Scope

This app now covers the beta mobile shell:

- auth and onboarding persistence
- Today, Library, and Account tabs
- design tokens
- Supabase client setup without server secrets
- Account/Settings push notification permission and preference flow
- Account deletion, privacy, support, password reset, logout, and account switching

Push notification readiness:

- Permission is requested from Account/Settings after signup/onboarding, at a user-controlled moment.
- Android creates the default edition channel before token registration.
- The app stores Expo push tokens in `push_tokens`, re-registers on token refresh, and disables the signed-in user's tokens on logout or when notifications are turned off.
- Notification taps carry `drop_date` and route to the Newsletter edition view, falling back cleanly when no date is usable.
- The backend sender reads enabled tokens and sends one calm edition notification only on edition days. Expo tickets are reconciled later through the receipt command.

## TestFlight Checklist

Before uploading a build:

- Run `npm run typecheck`.
- Run `npx expo config --type public` and confirm name, bundle identifier,
  version, iOS build number, scheme, icon, splash, and notification config.
- Build with `npm run build:ios:preview` for internal device testing.
- Install on a physical iPhone through the development build or TestFlight.
- Sign up, complete onboarding, log out, log back in, open Today, open Library,
  edit Account preferences, and toggle the daily reminder.
- Confirm French and English flows do not mix languages.
- Confirm no service-role keys, raw user ids, stack traces, or developer-only
  diagnostic copy appear in the UI.
