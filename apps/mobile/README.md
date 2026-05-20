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

Then open the app in Expo Go, an iOS simulator, or an Android emulator.

## Environment

Use public client environment variables only:

```sh
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_EAS_PROJECT_ID=
```

Do not put service role keys, Resend keys, generation secrets, or production-only credentials in this app.

`EXPO_PUBLIC_EAS_PROJECT_ID` is optional for normal local development, but a real EAS project id is required before a physical device can register an Expo push token.

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
npm run typecheck
```

## Current Scope

This app now covers the beta mobile shell:

- auth and onboarding persistence
- Today, Library, and Account tabs
- design tokens
- Supabase client setup without server secrets
- Account-only push reminder permission flow

Push notification readiness is token capture only. The app asks for notification permission from Account after signup/onboarding, stores Expo push tokens in `push_tokens` only when the RLS-protected table exists, and keeps working when permission is denied or a simulator cannot register. Actual push delivery still needs a backend sender job that reads enabled tokens and `user_preferences.preferred_notification_time` by profile timezone, then sends through the Expo Push API with production APNs/FCM/EAS credentials.
