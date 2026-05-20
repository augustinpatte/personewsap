# Mobile Testing

## Local Expo Start

```sh
npm run mobile:start
```

## Tunnel Expo Start

Use this when testers are not on the same local network.

```sh
npm run mobile:tunnel
```

## Typecheck

```sh
npm run mobile:typecheck
```

## Expo Doctor

```sh
npm run mobile:doctor
```

## First-User Test Flow

1. Start Expo locally with `npm run mobile:start`, or use `npm run mobile:tunnel` for remote device testing.
2. Open the app in Expo Go or a TestFlight build.
3. Create a new account with a real test email.
4. Complete onboarding: choose language, goal, topics, article count, and daily frequency.
5. Confirm Today loads and clearly shows whether the drop is live data, no live drop, or mock fallback.
6. Open a content item, then save, complete, and rate at least one item.
7. Open Library and confirm past or fallback content is clearly labeled.
8. Open Account and confirm email, language, preferences, and logout are visible.
9. Log out and confirm the app returns to authentication.

## Production Config Blockers

Do not ship a production build until `apps/mobile/app.json` has real values for app icon, splash screen, iOS build number, and Android version code.
