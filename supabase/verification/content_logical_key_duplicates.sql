-- Published content that shares one logical identity. READ-ONLY.
--
-- The intended invariant: at most one PUBLISHED content item per
-- (content_logical_key(metadata), language, content_type). FR/EN pairing, Team
-- assignments, scored questions and archive de-duplication all resolve content
-- through that identity, and a duplicate makes the answer depend on row order.
--
-- It is NOT enforced by a unique index:
-- content:catalog-publish flips every 'review' row of a catalog run to
-- 'published' without retiring an earlier published version of the same
-- catalog_entry_id, so a second catalog run over the same entries legitimately
-- produces two published rows — and an index would make that publish fail half
-- way. This query is how the invariant is watched instead (schema doctor runs it).
--
-- No row returned = clean.

select
  public.content_logical_key(ci.metadata) as logical_key,
  ci.language,
  ci.content_type,
  count(*) as published_rows,
  array_agg(ci.id order by ci.created_at) as content_item_ids,
  array_agg(coalesce(ci.metadata->>'scheduler_mode', '?') order by ci.created_at) as written_by,
  min(ci.created_at) as first_created_at,
  max(ci.created_at) as last_created_at
from public.content_items ci
where ci.status = 'published'
  and public.content_logical_key(ci.metadata) is not null
group by 1, 2, 3
having count(*) > 1
order by published_rows desc, last_created_at desc;
