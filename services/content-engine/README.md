# PersoNewsAP Content Engine

Server-side content generation pipeline for the PersoNewsAP daily drop.

The service keeps generation away from mobile clients and writes generated content through Supabase service-role access only.

## Layers

- `src/sources`: RSS, news API, and curated source connectors.
- `src/processing`: deduplication, topic categorization, and importance ranking.
- `src/generation`: structured daily content generation and validation.
- `src/storage`: Supabase persistence for sources, content items, generation runs, and daily drops.
- `src/scheduler`: daily job orchestration and user daily drop assembly.

## Environment

Required for persistence:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `NEWS_API_KEY`
- `NEWS_API_ENDPOINT`

## Commands

```sh
npm run check
npm run build
```

## Daily Job

```ts
import { createContentEngine } from "@personewsap/content-engine";

const engine = createContentEngine();

await engine.runDailyContentJob({
  dropDate: "2026-04-26",
  languages: ["en", "fr"],
  publish: false
});
```

Generated items are stored as `review` content by default. Use `publish: true` only after an editorial review path exists.
