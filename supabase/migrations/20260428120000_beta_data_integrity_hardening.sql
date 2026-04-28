-- Production beta data-integrity hardening.
-- Additive only: does not touch legacy newsletter tables.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.daily_drops'::regclass
      AND c.contype IN ('p', 'u')
      AND (
        SELECT array_agg(a.attname ORDER BY cols.ordinality)
        FROM unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid
         AND a.attnum = cols.attnum
      ) = ARRAY['user_id', 'drop_date']
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.daily_drops
      GROUP BY user_id, drop_date
      HAVING count(*) > 1
    ) THEN
      ALTER TABLE public.daily_drops
        ADD CONSTRAINT daily_drops_user_drop_date_unique UNIQUE (user_id, drop_date);
    ELSE
      RAISE EXCEPTION 'Cannot add daily_drops_user_drop_date_unique: duplicate user_id/drop_date rows exist.';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.daily_drop_items'::regclass
      AND c.contype IN ('p', 'u')
      AND (
        SELECT array_agg(a.attname ORDER BY cols.ordinality)
        FROM unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid
         AND a.attnum = cols.attnum
      ) = ARRAY['daily_drop_id', 'content_item_id']
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.daily_drop_items
      GROUP BY daily_drop_id, content_item_id
      HAVING count(*) > 1
    ) THEN
      ALTER TABLE public.daily_drop_items
        ADD CONSTRAINT daily_drop_items_drop_content_unique UNIQUE (daily_drop_id, content_item_id);
    ELSE
      RAISE EXCEPTION 'Cannot add daily_drop_items_drop_content_unique: duplicate daily_drop_id/content_item_id rows exist.';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.daily_drop_items'::regclass
      AND c.contype IN ('p', 'u')
      AND (
        SELECT array_agg(a.attname ORDER BY cols.ordinality)
        FROM unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid
         AND a.attnum = cols.attnum
      ) = ARRAY['daily_drop_id', 'slot', 'position']
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.daily_drop_items
      GROUP BY daily_drop_id, slot, position
      HAVING count(*) > 1
    ) THEN
      ALTER TABLE public.daily_drop_items
        ADD CONSTRAINT daily_drop_items_drop_slot_position_unique UNIQUE (daily_drop_id, slot, position);
    ELSE
      RAISE EXCEPTION 'Cannot add daily_drop_items_drop_slot_position_unique: duplicate daily_drop_id/slot/position rows exist.';
    END IF;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS content_interactions_complete_once_per_user_content
ON public.content_interactions (user_id, content_item_id)
WHERE interaction_type = 'complete';

CREATE UNIQUE INDEX IF NOT EXISTS content_interactions_save_once_per_user_content
ON public.content_interactions (user_id, content_item_id)
WHERE interaction_type = 'save';

COMMENT ON INDEX public.content_interactions_complete_once_per_user_content IS
  'Keeps complete interactions idempotent per user/content item for beta.';

COMMENT ON INDEX public.content_interactions_save_once_per_user_content IS
  'Keeps save interactions idempotent per user/content item for beta.';
