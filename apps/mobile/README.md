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
```

Do not put service role keys, Resend keys, generation secrets, or production-only credentials in this app.

## Useful Commands

```sh
npm run start
npm run ios
npm run android
npm run typecheck
```

## Current Scope

This is a routing and architecture skeleton only:

- auth placeholders
- onboarding placeholders
- Today, Library, and Account tabs
- design tokens
- Supabase client setup without real secrets

Business logic, daily drop fetching, onboarding persistence, push notifications, and generation pipeline integration are intentionally not implemented yet.
