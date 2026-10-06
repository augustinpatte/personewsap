-- Input size limits on client-writable text — PRODUCTION.
--
-- Columns a reader (or, for two legacy web tables, an anonymous visitor) can
-- write had no upper bound: a script with the anon key could store megabytes
-- per row in newsletter_feedback or pending_registrations, and a signed-in
-- reader the same in their own response and interaction rows.
--
-- The limits are far above anything the product writes, so no legitimate
-- write is affected:
--
--   mini_case_responses.answer_md     10,000 chars  (the app writes one short
--                                                    line per question)
--   mini_case_responses.ai_feedback_md 20,000 chars
--   mini_case_responses.selections     10,000 chars of JSON (question -> option)
--   content_interactions.message        2,000 chars  (same bound as
--                                                    user_reports.details)
--   newsletter_feedback.message         5,000 chars  (legacy web form)
--   newsletter_feedback.email             320 chars  (RFC 5321 maximum)
--   pending_registrations.email           320 chars
--   pending_registrations.payload      20,000 chars of JSON (legacy web
--                                                    signup; no current writer)
--
-- NOT VALID: the constraints bind every new INSERT and UPDATE immediately but
-- do not scan existing rows, so a historic oversized row can never make this
-- migration fail. supabase/verification/input_length_violations.sql lists any
-- such row; once it returns nothing, the constraints can be validated with
-- ALTER TABLE ... VALIDATE CONSTRAINT (no lock on writes).
--
-- user_reports.details already has its own 2,000-character limit.
-- Forward-only, additive.

BEGIN;

ALTER TABLE public.mini_case_responses
  ADD CONSTRAINT mini_case_responses_answer_md_length_check
    CHECK (answer_md IS NULL OR length(answer_md) <= 10000) NOT VALID,
  ADD CONSTRAINT mini_case_responses_ai_feedback_md_length_check
    CHECK (ai_feedback_md IS NULL OR length(ai_feedback_md) <= 20000) NOT VALID,
  ADD CONSTRAINT mini_case_responses_selections_size_check
    CHECK (selections IS NULL OR length(selections::text) <= 10000) NOT VALID;

ALTER TABLE public.content_interactions
  ADD CONSTRAINT content_interactions_message_length_check
    CHECK (message IS NULL OR length(message) <= 2000) NOT VALID;

ALTER TABLE public.newsletter_feedback
  ADD CONSTRAINT newsletter_feedback_message_length_check
    CHECK (message IS NULL OR length(message) <= 5000) NOT VALID,
  ADD CONSTRAINT newsletter_feedback_email_length_check
    CHECK (email IS NULL OR length(email) <= 320) NOT VALID;

ALTER TABLE public.pending_registrations
  ADD CONSTRAINT pending_registrations_email_length_check
    CHECK (email IS NULL OR length(email) <= 320) NOT VALID,
  ADD CONSTRAINT pending_registrations_payload_size_check
    CHECK (payload IS NULL OR length(payload::text) <= 20000) NOT VALID;

COMMIT;
