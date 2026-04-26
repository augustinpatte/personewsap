# PersoNewsAP Technical Plan

## Recommended Expo Architecture

PersoNewsAP should migrate to an Expo React Native app for iOS and Android.

Recommended structure:

```text
apps/mobile/
  app/
    (auth)/
      login.tsx
      signup.tsx
      reset-password.tsx
    (onboarding)/
      language.tsx
      goals.tsx
      topics.tsx
      frequency.tsx
    (tabs)/
      today.tsx
      library.tsx
      account.tsx
  src/
    components/
    features/
      auth/
      onboarding/
      today/
      library/
      preferences/
      feedback/
    lib/
      supabase.ts
      i18n.ts
      dates.ts
    design/
      tokens.ts
```

Recommended choices:

- Expo Router for navigation.
- TypeScript for all app code.
- Supabase Auth for identity.
- React Query for server state.
- SecureStore or AsyncStorage for Supabase session persistence.
- EAS Build for iOS and Android.

The existing Vite app may remain temporarily as a web prototype or admin surface, but the main user product should move to Expo.

## Supabase Schema Direction

The current schema should evolve from newsletter signup tables to a content platform.

Core table groups:

- Identity:
  - `profiles`
  - `user_preferences`
  - `user_topic_preferences`
- Taxonomy:
  - `topics`
  - `goals`
- Content:
  - `content_items`
  - `sources`
  - `content_item_sources`
  - `generation_runs`
- Daily experience:
  - `daily_drops`
  - `daily_drop_items`
- Interaction:
  - `content_interactions`
  - `mini_case_responses`
  - `feedback`

Database changes should be additive. Existing `users`, `user_topics`, and `newsletter_feedback` should not be deleted until migration is complete.

## Migration Strategy From The Current App

1. Keep the current web app working.
2. Add new Supabase tables with migrations.
3. Seed the new topic taxonomy:
   - `business`
   - `finance`
   - `tech_ai`
   - `law`
   - `medicine`
   - `engineering`
   - `sport_business`
   - `culture_media`
4. Add migration mapping from old topic keys:
   - `sport` -> `sport_business` where relevant.
   - `finance` and `stocks` -> `finance`.
   - `ai` -> `tech_ai`.
   - `pharma` -> `medicine`.
   - `culture` -> `culture_media`.
   - `international`, `automotive`, and other old keys need manual or product-approved mapping.
5. Build the Expo app against the new schema.
6. Move generation output into database tables.
7. Update email dispatch to read stored daily drops instead of raw JSON article files.
8. Retire old onboarding once mobile onboarding is stable.

## Generation Pipeline

The generation pipeline should run server-side, never inside the mobile client.

Recommended stages:

1. Source collection
   - Fetch or import candidate sources by topic.
   - Store metadata in `sources`.
   - Deduplicate by URL and content hash.

2. Editorial planning
   - Define the daily content plan by date and language.
   - Choose the main themes and modules.
   - Store generation metadata in `generation_runs`.

3. Draft generation
   - Generate structured JSON for each module.
   - Generate FR and EN as equivalent editorial versions, not literal translations.
   - Include source references for every factual item.

4. Validation
   - Check required fields.
   - Check source presence.
   - Check approved topic IDs and content types.
   - Check legal, medical, and financial safety constraints.

5. Persistence
   - Store generated items in `content_items`.
   - Attach sources through `content_item_sources`.
   - Store prompt/model/generator versions in `generation_runs`.

6. Publishing
   - Mark reviewed content as published.
   - Assemble user-specific `daily_drops`.
   - Attach items through `daily_drop_items`.

7. Delivery
   - Push notification for mobile users who opted in.
   - Optional email summary through Resend.

## Daily Drop Architecture

The Today screen should query one daily drop for the authenticated user and date.

Recommended behavior:

- One drop per user per local day.
- Timezone-aware publishing.
- Cached after first load.
- Read/completion state stored in `content_interactions`.
- No infinite scroll.
- If no drop exists, show a calm empty state and retry option.

The daily drop has four slots:

- `newsletter`
- `business_story`
- `mini_case`
- `concept`

Each slot should link to one or more published `content_items`.

## Library Architecture

The Library gives users access to past content without undermining the one-daily-drop principle.

Recommended features:

- Past daily drops by date.
- Filters by content type.
- Filters by topic.
- Saved items.
- Completed items.

The Library should feel like an archive, not a feed. It should not encourage endless consumption as the primary behavior.

## Push Notification Architecture

Push notifications should be opt-in and tied to daily drops.

Recommended flow:

1. Ask for notification permission after the user understands the product value.
2. Store Expo push token in Supabase.
3. Store notification preference and timezone.
4. Send one daily notification when the drop is ready.
5. Avoid sending multiple engagement notifications by default.

Suggested tables:

- `device_tokens`
  - `user_id`
  - `platform`
  - `expo_push_token`
  - `enabled`
  - `created_at`
  - `updated_at`

Push sending should happen server-side with service credentials.

## Testing Strategy

Minimum testing expectations:

- Unit tests for preference mapping and date logic.
- Component tests for onboarding and Today rendering.
- Supabase RLS tests for profile, preferences, drops, and interactions.
- Generation validation tests against malformed JSON and missing sources.
- End-to-end mobile smoke tests for:
  - signup/login
  - onboarding
  - Today load
  - Library load
  - feedback

When tests cannot run, explain why and name the residual risk.

## Implementation Milestones

### Milestone 1: Documentation and product alignment

- Product brief.
- Content system.
- Technical plan.
- Permanent agent rules.

### Milestone 2: Data foundation

- Add Supabase schema migrations.
- Seed topics and goals.
- Add RLS policies.
- Generate updated Supabase types.

### Milestone 3: Expo app shell

- Scaffold Expo app.
- Configure navigation.
- Configure Supabase client.
- Add auth screens.
- Add base design tokens.

### Milestone 4: Onboarding and preferences

- Implement language, topics, article counts, frequency, and goals.
- Persist preferences.
- Add account preference editing.

### Milestone 5: Daily content MVP

- Add manually seeded daily drops.
- Render Today screen.
- Render four modules.
- Add completion and feedback.

### Milestone 6: Library MVP

- Show past daily drops.
- Add saved and completed item states.
- Add basic filters.

### Milestone 7: Generation MVP

- Build source ingestion.
- Generate structured content.
- Validate sources and required fields.
- Persist generated items and runs.
- Assemble daily drops.

### Milestone 8: Launch readiness

- Add push notifications.
- Add privacy/account deletion flows.
- Add monitoring for generation and delivery failures.
- Run iOS and Android build verification.
