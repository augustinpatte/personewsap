# PersoNewsAP Agent Rules

These rules apply to future Codex tasks in this repository.

## Working Principles

- Make small, reviewable changes.
- Do not rewrite unrelated code.
- Preserve existing working features unless explicitly asked to change them.
- Prefer TypeScript for application code.
- Keep database changes additive.
- Never expose Supabase service role keys or other server secrets client-side.
- Write clear commit-style summaries.
- Run tests when relevant, or explain why tests cannot run.
- Ask before deleting major files.
- Maintain the one-daily-drop product principle.

## Product Principle

PersoNewsAP is not an infinite feed. It is a premium 5-minute daily learning product.

Every product, design, data, and engineering decision should protect the core experience:

- one daily update
- high signal
- sourced content
- direct tone
- useful learning
- Library for past content, not endless scrolling

## Code Change Rules

- Read existing code before editing.
- Follow existing patterns unless there is a clear reason to introduce a new one.
- Keep changes scoped to the user request.
- Avoid broad refactors during feature work.
- Avoid formatting-only churn in unrelated files.
- Do not remove existing routes, scripts, or migrations unless the user explicitly approves it.
- Do not silently replace working web behavior while the migration is incomplete.

## TypeScript Rules

- Prefer explicit domain types for product concepts.
- Keep topic IDs and goal IDs as typed constants or enums.
- Avoid stringly typed content modules when a union type is practical.
- Keep generated Supabase types in sync after schema changes.

## Database Rules

- Use additive migrations by default.
- Preserve current tables during migration:
  - `users`
  - `user_topics`
  - `newsletter_feedback`
  - `pending_registrations`
- Add compatibility views or migration scripts when moving to new tables.
- Write RLS policies for every user-facing table.
- Keep service role operations server-side only.
- Do not put generation secrets, Resend keys, or service role keys in Expo or Vite client code.

## Content Rules

- Preserve FR/EN support.
- Treat FR and EN as equivalent editorial versions, not literal translations.
- Require sources for factual content.
- Track dates, versions, prompt versions, and source metadata.
- Avoid generic AI filler.
- Use a premium, direct, useful tone for ambitious 18-25 year-old students.
- Be careful with law, medicine, and finance content.

## Testing Rules

- Run the relevant test command after code changes when feasible.
- For web changes, consider `npm run test`, `npm run lint`, or `npm run build`.
- For mobile changes, run the relevant Expo or TypeScript checks once available.
- For database changes, test or reason through RLS explicitly.
- If a test cannot run because dependencies, env vars, or services are missing, state that clearly.

## Summary Rules

Every final response after implementation should include:

- What changed.
- What files were touched.
- What was verified.
- Any known limitations or follow-up risks.

Use concise, commit-style summaries. Do not over-explain obvious implementation details.

## Deletion Rules

Ask before deleting:

- major directories
- migrations
- production scripts
- generated assets with unclear ownership
- existing app routes
- historical logs or previews

Small generated files may be removed only when clearly safe and directly related to the task.
