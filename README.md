# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## Self-hosted setup (without Lovable)

### 1) Install dependencies

```sh
npm install
```

### 2) Supabase project

1. Create a Supabase project.
2. Apply the SQL migrations in `supabase/migrations`.
3. In Supabase Authentication settings:
   - Enable email provider.
   - Set the Site URL to your production domain.
   - Add `https://<your-domain>/verify` to Redirect URLs.

### 3) Environment variables

Create a `.env` file (or configure your hosting provider) with:

```
VITE_SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="YOUR_ANON_KEY"
```

### 4) Run locally

```sh
npm run dev
```

### 5) Newsletter feedback links

At the end of each newsletter, include a link like:

```
https://<your-domain>/feedback?email={{email}}&issue=YYYY-MM-DD&lang=fr
```

Replace `lang=fr` with `lang=en` as needed.

## Local MVP Developer Workflow

Use [TESTING.md](TESTING.md) for the full tester handoff flow and [MVP_STATUS.md](MVP_STATUS.md) for the current MVP readiness notes.

### Smoke Checks

Run the current MVP smoke flow from the repo root:

```sh
npm run smoke
```

This runs:

- `npm run mobile:typecheck`
- `npm run content:build`
- `npm run content:dry-run`

Useful single checks:

```sh
npm run mobile:typecheck
npm run content:build
npm run content:dry-run
```

### Mobile App

From the repo root:

```sh
cd apps/mobile
npm install
npm run ios
```

Use `npm run android` for Android or `npm run start` for the Expo launcher. The mobile TypeScript check can be run from the repo root with `npm run mobile:typecheck`.

Mobile env vars belong in `apps/mobile/.env`. Only use public client keys there, such as `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Never put a Supabase service role key in the mobile app.

### Content Engine

From the repo root:

```sh
npm --prefix services/content-engine install
npm run content:build
npm run content:dry-run
```

`content:dry-run` builds the content engine and generates local output from sample sources. It does not write to Supabase.

For LLM generation, configure server-side env vars in `services/content-engine/.env` or your shell, then run:

```sh
npm --prefix services/content-engine run llm-run
```

### Persistence Test

`persist-test` writes test content and requires an explicit confirmation flag. Use a local or disposable Supabase project unless you intentionally choose another environment.

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_PERSIST_TEST=true \
npm --prefix services/content-engine run persist-test
```

If test content was created with a `test_run_id`, clean it up with:

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_CLEANUP_TEST=true \
npm --prefix services/content-engine run cleanup-test -- --test-run-id persist-test-...
```

### Environment Safety

- `.env` and `.env.*` files are ignored; keep real keys local.
- The checked ignore rules cover root `.env`, `apps/mobile/.env`, `services/content-engine/.env`, and `supabase/.temp`.
- Service role keys are server-side only. Do not place them in Expo, Vite, or any checked-in config.
- Do not paste real API keys into logs, docs, issue comments, or screenshots.
