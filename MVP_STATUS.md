# PersoNewsAP MVP Status

## What Works

- Mobile app package has Expo scripts for local simulator work and a TypeScript check.
- Root smoke workflow checks mobile TypeScript, content-engine build, and content-engine dry-run.
- Content engine can build, dry-run from sample input, run LLM generation when configured, and run explicit persistence test commands.
- Persistence test content is intentionally marked as test content and can be cleaned up by test run id.
- Local `.env` files are ignored for the root app, mobile app, and content engine.

## What Is Mocked

- Mobile screens can fall back to mock daily content when live Supabase data or a session is unavailable.
- Content-engine dry-run uses bundled sample source data and does not publish content.
- LLM generation and persistence require real server-side environment variables and are outside the default smoke flow.
- Some production operations, scheduling, and editorial review steps are still manual.

## Not Production-Ready

- Never put Supabase service role keys in Expo, Vite, or other client-side environments.
- Run `persist-test` only against local, disposable, or deliberately selected Supabase projects.
- Real LLM output still needs editorial review before publication.
- Production scheduling, monitoring, push-notification QA, account lifecycle flows, and release hardening need more validation.
