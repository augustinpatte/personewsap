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
- `OPENAI_API_KEY`
- `OPENAI_MODEL` defaults to `gpt-4.1-mini`
- `OPENAI_REQUEST_TIMEOUT_MS` defaults to `60000`

## Commands

```sh
npm run check
npm run build
npm run dry-run
npm run llm-run
```

`dry-run` builds the service and runs the local executable without Supabase writes, migrations, API keys, or LLM calls.

The default dry run uses bundled sample articles, including a duplicate URL variant, then runs the normal pipeline:

1. source collection
2. deduplication
3. topic categorization
4. importance ranking
5. placeholder structured generation
6. validation
7. JSON printing

```sh
npm run dry-run
```

Useful options:

```sh
npm run dry-run -- --date 2026-04-26
npm run dry-run -- --languages en,fr
npm run dry-run -- --topics business,finance,tech_ai
npm run dry-run -- --newsletter-count 3
```

Optional live RSS fetching can be added without API keys:

```sh
npm run dry-run -- --live-rss
```

The command prints a JSON object with diagnostics and one or more daily drop payloads. `persisted` is always `false` in dry-run mode.

## LLM Generation

`llm-run` uses the same source collection and processing pipeline, then asks OpenAI for the final structured daily drop. It still does not write to Supabase.

```sh
OPENAI_API_KEY=sk-... npm run llm-run
```

For safe local testing, `llm-run` always limits the generated drop to:

1. one newsletter article
2. one business story
3. one mini-case
4. one concept

This keeps local OpenAI requests smaller and easier to inspect. `dry-run` is unchanged and still honors `--newsletter-count`.

Useful options mostly match `dry-run`:

```sh
OPENAI_API_KEY=sk-... npm run llm-run -- --date 2026-04-26
OPENAI_API_KEY=sk-... npm run llm-run -- --languages en,fr
OPENAI_API_KEY=sk-... npm run llm-run -- --topics business,finance,tech_ai
```

`--newsletter-count` is intentionally ignored by `llm-run` local test mode and capped at one newsletter article.

The LLM path uses structured JSON output, validates the generated daily drop, and retries when required fields, source URLs, dates, reading time, slot/type consistency, or module counts are invalid. If `OPENAI_API_KEY` is missing, the command exits with a clear error before any generation request is attempted.

Progress logs are printed to stderr so stdout can remain valid JSON for scripts. A normal run shows:

- source fetch started/completed
- processing started/completed
- LLM generation started/completed for each planned/generated item
- validation started/completed

Use a shorter timeout when testing failure handling:

```sh
OPENAI_API_KEY=sk-... OPENAI_REQUEST_TIMEOUT_MS=10000 npm run llm-run
```

If OpenAI fails, the command reports whether the failure was a timeout, network/endpoint problem, HTTP/API error, missing JSON output, or invalid JSON.

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
