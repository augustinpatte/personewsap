-- Rows that exceed the input limits of 20261005182000_input_length_limits.
-- READ-ONLY. Run before validating those NOT VALID constraints:
--
--   ALTER TABLE public.mini_case_responses VALIDATE CONSTRAINT mini_case_responses_answer_md_length_check;
--   ... (one per constraint)
--
-- No row returned = every constraint can be validated. Nothing here deletes or
-- truncates anything: an oversized historic row is a decision for a person.

select 'mini_case_responses.answer_md' as column_name, id::text as row_id, length(answer_md) as size
from public.mini_case_responses where length(answer_md) > 10000
union all
select 'mini_case_responses.ai_feedback_md', id::text, length(ai_feedback_md)
from public.mini_case_responses where length(ai_feedback_md) > 20000
union all
select 'mini_case_responses.selections', id::text, length(selections::text)
from public.mini_case_responses where length(selections::text) > 10000
union all
select 'content_interactions.message', id::text, length(message)
from public.content_interactions where length(message) > 2000
union all
select 'newsletter_feedback.message', id::text, length(message)
from public.newsletter_feedback where length(message) > 5000
union all
select 'newsletter_feedback.email', id::text, length(email)
from public.newsletter_feedback where length(email) > 320
union all
select 'pending_registrations.email', id::text, length(email)
from public.pending_registrations where length(email) > 320
union all
select 'pending_registrations.payload', id::text, length(payload::text)
from public.pending_registrations where length(payload::text) > 20000
order by 1, 3 desc;
