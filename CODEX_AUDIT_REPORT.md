# PersoNewsAP Technical Audit Report

## Current architecture summary

PersoNewsAP is currently a Vite + React + TypeScript web application backed by Supabase. It is still shaped like an AI-generated newsletter configurator rather than a native mobile education product.

### Frontend stack

- App framework: Vite, React 18, TypeScript.
- Styling: Tailwind CSS with shadcn/ui and Radix primitives.
- Routing: `react-router-dom`.
- Data/auth client: `@supabase/supabase-js`.
- State:
  - `LanguageContext` stores FR/EN selection and translation strings.
  - `WizardContext` stores signup wizard state: selected topics, article counts, profile data, and registered user id.
- Tests: Vitest is configured, but current coverage is only a placeholder test.

### Existing routes

- `/`: signup wizard.
- `/verify`: email verification completion flow.
- `/login`: Supabase password login.
- `/account`: preference management and unsubscribe.
- `/feedback`: newsletter feedback form.
- `*`: 404 page.

### Current user flow

The main flow is implemented in `src/pages/Index.tsx` as a web wizard:

1. Entry screen.
2. Language choice.
3. Topic choice.
4. Article count per selected topic, currently 1 to 3.
5. Signup with email/password and optional phone/WhatsApp opt-in.
6. Email verification when Supabase requires it.
7. Confirmation.

The signup flow stores pending registration data in browser `localStorage`. After the Supabase auth session is available, `completeRegistration` writes the profile into `users` and preferences into `user_topics`.

### Current Supabase schema

The active schema is small:

- `users`
  - Auth-linked newsletter profile.
  - Fields include language, first name, last name, email, phone, WhatsApp opt-in, email opt-in, and `verified_at`.
- `user_topics`
  - One row per user/topic.
  - Stores `articles_count` from 1 to 3.
- `newsletter_feedback`
  - Public insert table for simple feedback on an issue.
- `pending_registrations`
  - Exists in migrations but is not used by the frontend flow.

RLS was improved in the second migration for `users` and `user_topics`, but `newsletter_feedback` and `pending_registrations` still allow broad public inserts. That may be acceptable for a prototype, but it needs abuse controls before a mobile launch.

### Current newsletter dispatch

Newsletter delivery is handled by `dispatchnewsletter.py`, outside the React app.

The script:

- Loads articles from a JSON file.
- Normalizes language/topic/title/content/sources.
- Fetches opted-in users and their topic preferences from Supabase.
- Selects articles by language, topic, and requested count.
- Builds text and HTML email.
- Sends via Resend.
- Writes CSV logs to `send_logs`.
- Supports dry-run previews in `previews`.

This is useful operational code, but it is not yet a reliable content platform. Articles are not persisted as first-class database records, generation runs are not versioned, and there is no daily app content model.

## Reusable components

### Product logic that can be reused

- Language preference concept: FR/EN is already central to onboarding and account settings.
- Topic preference concept: users already choose topics and per-topic article counts.
- Supabase Auth integration: email/password auth and session handling can remain the backend identity foundation.
- Supabase profile model: `users` can evolve into `profiles`.
- Preference update flow: `/account` proves that users can update preferences and opt out.
- Feedback capture: the feedback table is a good seed for content ratings and qualitative feedback.
- Newsletter topic selection logic: the topic-to-article matching logic in `dispatchnewsletter.py` can inform the first generation pipeline.
- Email rendering: the current HTML builder can remain useful for email delivery if the mobile app also sends email summaries.

### Code patterns worth keeping

- TypeScript-first app code.
- Centralized Supabase client.
- Centralized language context, though it should be replaced by a proper i18n/content strategy.
- Use of generated Supabase types.
- Form validation with Zod in signup.
- Explicit topic keys instead of free-text user topic names.

### Assets and operational artifacts

- Existing newsletter previews and send logs are useful historical artifacts, but should not become the core data source.
- Current migrations are a baseline, but a new mobile schema should be introduced with additive migrations.

## Refactor plan

### High-level refactor direction

The project should move from "web signup form plus Python sender" to "mobile app plus Supabase content backend plus scheduled generation pipeline".

The biggest architectural shift is that daily content should be generated, reviewed, stored, versioned, and served from the database. The mobile app should not generate content on demand for every user. It should fetch the user's one daily drop and historical library entries.

### What must change

- Replace the Vite web app as the primary product with an Expo app.
- Move persistent mobile session storage to React Native compatible storage, such as SecureStore or AsyncStorage.
- Replace web-only assumptions:
  - `window`
  - `localStorage`
  - browser redirects
  - HTML form controls
  - React Router
- Replace in-file translation strings with a real localization/content system.
- Rename and expand topics:
  - Current: sport, international, finance, stocks, automotive, pharma, ai, culture.
  - Target: business, finance, tech_ai, law, medicine, engineering, sport_business, culture_media.
- Add frequency and user goal preferences.
- Add a daily content model:
  - personalized newsletter
  - business story
  - mini-case challenge
  - key concept
- Add Library data access for past content.
- Add content provenance:
  - sources
  - generation prompt version
  - model/version
  - publication date
  - content status
  - audit trail
- Replace manual JSON article files as the primary input with database-backed content runs.
- Add admin/generation tooling separate from the user app.

### What can be temporarily kept

- Existing web app can remain as an admin/prototype surface during migration.
- Existing `users` and `user_topics` can be migrated rather than deleted.
- `dispatchnewsletter.py` can be retained as a dry-run sender or legacy email delivery job until an Edge Function or scheduled worker replaces it.

### Recommended migration strategy

1. Add new schema while preserving existing tables.
2. Create a compatibility view or migration script from old topic keys to new topic keys.
3. Build Expo app against the new schema.
4. Move generation output into Supabase tables.
5. Switch dispatch to read from stored daily content, not raw JSON files.
6. Deprecate old web onboarding once mobile onboarding is stable.

## Proposed mobile architecture

### Client app

Use Expo with React Native and TypeScript.

Recommended structure:

```text
apps/mobile/
  app/
    (auth)/
    (onboarding)/
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

Recommended Expo libraries:

- Expo Router for navigation.
- `@supabase/supabase-js` with React Native compatible storage.
- SecureStore for auth token persistence where appropriate.
- React Query for server state caching.
- EAS Build for iOS/Android builds.

### Primary mobile screens

- Auth:
  - login
  - signup
  - password reset
  - email verification handling
- Onboarding:
  - language
  - goals
  - topics
  - article count
  - frequency
- Today:
  - one daily drop only
  - clear completion state
  - four modules:
    - personalized newsletter
    - business story
    - mini-case challenge
    - key concept
- Library:
  - previous daily drops
  - filters by date, topic, content type, language
- Account:
  - profile
  - preferences
  - language
  - privacy/export/delete
  - feedback history if needed

### Backend boundary

The mobile app should only call safe Supabase endpoints with anon key and RLS. All generation, source fetching, editorial review, and admin actions should happen server-side with service role access in one of these options:

- Supabase Edge Functions plus scheduled jobs.
- A separate worker service deployed on a platform such as Vercel, Fly, or Cloudflare.
- A local/admin script only for prototype phase.

## Proposed Supabase schema

The following schema is intentionally normalized around content traceability, daily drops, and personalization.

### Core identity

```sql
profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  email text not null unique,
  first_name text,
  last_name text,
  birth_year int,
  language text not null check (language in ('fr', 'en')),
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

### Preferences

```sql
user_preferences (
  user_id uuid primary key references profiles(id) on delete cascade,
  goal text not null check (goal in (
    'understand_world',
    'prepare_career',
    'learn_business',
    'explore_stem',
    'become_sharper_daily'
  )),
  frequency text not null default 'daily',
  newsletter_article_count int not null default 8,
  notifications_enabled boolean not null default false,
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now()
)
```

```sql
topics (
  id text primary key,
  position int not null,
  label_fr text not null,
  label_en text not null,
  active boolean not null default true
)
```

Seed topics:

- `business`
- `finance`
- `tech_ai`
- `law`
- `medicine`
- `engineering`
- `sport_business`
- `culture_media`

```sql
user_topic_preferences (
  user_id uuid references profiles(id) on delete cascade,
  topic_id text references topics(id),
  articles_count int not null check (articles_count between 1 and 3),
  enabled boolean not null default true,
  position int,
  primary key (user_id, topic_id)
)
```

### Content generation and provenance

```sql
generation_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  content_type text not null check (content_type in (
    'newsletter_article',
    'business_story',
    'mini_case',
    'concept'
  )),
  language text not null check (language in ('fr', 'en')),
  status text not null check (status in (
    'queued',
    'running',
    'generated',
    'reviewed',
    'published',
    'failed'
  )),
  model_name text,
  prompt_version text not null,
  generator_version text,
  input_hash text,
  output_hash text,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
)
```

```sql
sources (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  title text,
  publisher text,
  author text,
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  language text,
  credibility_score numeric,
  content_hash text,
  unique (url)
)
```

```sql
content_items (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in (
    'newsletter_article',
    'business_story',
    'mini_case',
    'concept'
  )),
  topic_id text references topics(id),
  language text not null check (language in ('fr', 'en')),
  title text not null,
  summary text,
  body_md text not null,
  difficulty text check (difficulty in ('easy', 'medium', 'hard')),
  estimated_read_seconds int,
  publication_date date not null,
  version int not null default 1,
  status text not null check (status in (
    'draft',
    'review',
    'published',
    'archived'
  )),
  generation_run_id uuid references generation_runs(id),
  source_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

```sql
content_item_sources (
  content_item_id uuid references content_items(id) on delete cascade,
  source_id uuid references sources(id) on delete restrict,
  claim text,
  source_order int not null default 0,
  primary key (content_item_id, source_id)
)
```

### Daily drops and personalization

```sql
daily_drops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  drop_date date not null,
  language text not null check (language in ('fr', 'en')),
  status text not null check (status in ('generated', 'published', 'read', 'archived')),
  generated_at timestamptz not null default now(),
  published_at timestamptz,
  unique (user_id, drop_date)
)
```

```sql
daily_drop_items (
  daily_drop_id uuid references daily_drops(id) on delete cascade,
  content_item_id uuid references content_items(id) on delete restrict,
  slot text not null check (slot in (
    'newsletter',
    'business_story',
    'mini_case',
    'concept'
  )),
  position int not null default 0,
  primary key (daily_drop_id, content_item_id)
)
```

### Interaction and feedback

```sql
content_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  content_item_id uuid references content_items(id) on delete cascade,
  interaction_type text not null check (interaction_type in (
    'view',
    'complete',
    'save',
    'share',
    'feedback'
  )),
  rating text check (rating in ('good', 'average', 'bad')),
  message text,
  created_at timestamptz not null default now()
)
```

### Mini-case answers

```sql
mini_case_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  content_item_id uuid references content_items(id) on delete cascade,
  answer_md text not null,
  ai_feedback_md text,
  score numeric,
  created_at timestamptz not null default now()
)
```

### RLS principles

- Users can read and update their own profile and preferences.
- Users can read their own daily drops and interactions.
- Users can read published `content_items` and attached `sources`.
- Only service role can create/update generation runs, sources, content items, and daily drop assignments.
- Public anonymous inserts should be avoided except tightly rate-limited feedback endpoints.

## AI generation pipeline

The target pipeline should produce stored daily content, not ephemeral responses.

### Pipeline goals

- One daily drop per user.
- No infinite feed.
- FR/EN content parity by editorial intent, not literal translation.
- All content sourced, dated, versioned, and traceable.
- Free product at launch, but backend should support future premium gates.

### Recommended stages

1. Source collection
   - Pull reputable sources per topic.
   - Store source metadata in `sources`.
   - Deduplicate by URL and content hash.
   - Capture retrieval time and published date.

2. Source ranking
   - Score by freshness, relevance, authority, topic fit, and language.
   - Reject low-quality or unsourced items.

3. Content planning
   - Create a daily editorial plan per language.
   - Decide which topics receive newsletter articles.
   - Decide business story, mini-case, and concept.
   - Store run metadata in `generation_runs`.

4. Draft generation
   - Generate article drafts from selected sources.
   - Generate FR and EN independently from the same source set and editorial brief.
   - Require structured output:
     - title
     - summary
     - body markdown
     - claims
     - source references
     - difficulty
     - estimated reading time

5. Validation
   - Verify every factual claim has at least one source.
   - Check that publication dates are current.
   - Check that the content has no unsupported legal/medical/financial advice.
   - Check tone: premium, direct, ambitious, no filler.
   - Check length constraints for mobile reading.

6. Versioning and review
   - Save drafts as `content_items` with `status = draft` or `review`.
   - Attach source links in `content_item_sources`.
   - Increment version on regeneration.

7. Publishing
   - Mark approved content as `published`.
   - Create `daily_drops` for each active user.
   - Attach personalized items through `daily_drop_items`.

8. Delivery
   - Mobile push notification if enabled.
   - Optional email summary via Resend.
   - App opens to the single Today drop.

9. Observability
   - Log generation failures and validation failures.
   - Track content completion, ratings, and issue reports.
   - Add admin review dashboards before scaling.

### Personalization logic

Start simple:

- Use language.
- Use selected topics.
- Use article count per topic.
- Use goal to bias article framing:
  - understand_world: context and implications.
  - prepare_career: career relevance and skills.
  - learn_business: business models, strategy, markets.
  - explore_stem: technical explanations and applied science.
  - become_sharper_daily: concise mental models and decision quality.

Avoid per-user generation at launch unless required. Generate a daily pool per language/topic/goal, then compose per-user daily drops from that pool. This controls cost, latency, and quality.

## Suggested agent/task breakdown

### Agent 1: Repository migration and Expo scaffold

- Create Expo app structure.
- Configure TypeScript, linting, Expo Router, Supabase client, env handling.
- Establish shared domain types.

### Agent 2: Supabase schema and RLS

- Write additive migrations for the proposed schema.
- Add topic seeds.
- Add compatibility migration from current users/topics.
- Add RLS tests or SQL policy checks.

### Agent 3: Mobile onboarding and preferences

- Implement language, goals, topics, article counts, frequency.
- Implement auth/signup/login/reset flows.
- Persist preferences in Supabase.

### Agent 4: Today and Library experiences

- Implement daily drop screen.
- Implement content modules.
- Implement Library with date and type filters.
- Add completion and feedback interactions.

### Agent 5: Generation pipeline

- Convert `dispatchnewsletter.py` concepts into a server-side generation pipeline.
- Add source ingestion.
- Add structured generation outputs.
- Add validation and persistence.
- Add dry-run/admin review mode.

### Agent 6: Delivery and operations

- Add scheduled daily job.
- Add push notification flow.
- Keep optional email delivery via Resend.
- Add logging, retries, and alerting.

### Agent 7: QA and security

- Add tests for auth, RLS, onboarding, daily drop fetching, and feedback.
- Audit public insert paths.
- Validate mobile offline/cache behavior.
- Test iOS and Android builds.

## First implementation milestones

### Milestone 1: Product and data foundation

- Freeze v1 topic taxonomy.
- Freeze v1 content modules and length constraints.
- Add new Supabase schema migrations.
- Seed topics and goals.
- Add RLS policies.
- Add generated Supabase types.

### Milestone 2: Expo app shell

- Scaffold Expo app.
- Add navigation: Auth, Onboarding, Today, Library, Account.
- Configure Supabase auth with React Native storage.
- Implement design tokens for premium mobile tone.

### Milestone 3: Onboarding and preferences

- Implement signup/login.
- Implement language, goal, topic, article count, and frequency selection.
- Save preferences to Supabase.
- Migrate or map old web users where useful.

### Milestone 4: Daily drop MVP

- Create sample daily content records manually or via seed script.
- Render Today screen from `daily_drops`.
- Enforce one daily content drop in UX.
- Render Library from past drops.

### Milestone 5: Generation MVP

- Build a generation script or Edge Function that:
  - ingests sources
  - generates structured content
  - stores sources and content
  - creates generation run records
  - validates required fields and source links
- Generate both FR and EN from the same editorial plan.

### Milestone 6: Feedback and iteration loop

- Replace newsletter-only feedback with content-level feedback.
- Track completion and ratings.
- Add admin review exports or dashboard.
- Use feedback to tune prompts and topic priority.

### Milestone 7: Launch readiness

- Add push notifications.
- Add privacy/account deletion flows.
- Add abuse prevention and rate limits for public endpoints.
- Add monitoring for generation and delivery failures.
- Run end-to-end tests on iOS and Android.

## Risks, missing files, security issues, and scaling issues

### Missing or incomplete pieces

- No Expo/React Native app exists yet.
- No native mobile auth storage exists yet.
- No daily content tables exist.
- No Library model exists.
- No content source/versioning model exists.
- No prompt/version tracking exists.
- No real tests beyond a placeholder.
- No admin/editorial review interface exists.
- No scheduled job configuration is present in the repo.
- No push notification infrastructure exists.

### Security concerns

- `newsletter_feedback` allows public inserts with no visible rate limit.
- `pending_registrations` allows public insert/update and is not used by the app.
- Pending signup data is stored in browser `localStorage`, which is fragile and not suitable as a long-term cross-device auth bridge.
- `ConfirmationStep` displays auth email and auth user id in the UI, which should not be user-facing in production.
- The Python script uses a Supabase service role key, so it must only run server-side or locally in a trusted environment.
- Dry-run debug output can reveal key metadata and key fragments. This is risky if logs are shared.

### Scaling concerns

- Per-user generation would become expensive quickly. Use pooled content plus per-user assembly first.
- JSON-file based article input does not scale to traceability or editorial review.
- CSV send logs are not enough for production observability.
- The current topic aliases in Python are hand-maintained and will drift from app taxonomy unless centralized.
- Mobile users need timezone-aware daily drops; the current newsletter date is UTC-oriented.
- Email-only delivery does not fit the target app behavior; push and in-app delivery should become primary.

### Product risks

- "One daily drop" needs strict UX discipline. Library is allowed, but Today should not become a feed.
- FR/EN equivalent content requires editorial planning, not simple translation.
- Legal, medicine, and finance topics require stronger source and safety validation.
- Ambitious 18-25 year-old users will notice generic AI tone quickly; prompts and review must enforce direct, concrete, useful writing.

## Bottom line

The current repository is a useful prototype for subscription preferences, Supabase auth, and newsletter dispatch. The reusable core is the preference model and the operational idea of topic-based article selection. The target product needs a new mobile-first architecture and a database-backed content platform where every daily item is sourced, dated, versioned, reviewed, and served through a single Today experience plus a Library.
