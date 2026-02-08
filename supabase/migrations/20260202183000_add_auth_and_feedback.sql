-- Add auth linkage and verification timestamp to users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'users_auth_user_id_fkey'
      AND table_name = 'users'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_unique ON public.users(auth_user_id);

-- Replace overly broad RLS policies on users
DROP POLICY IF EXISTS "Anyone can insert new users" ON public.users;
DROP POLICY IF EXISTS "Users can view their own data by email" ON public.users;
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;

CREATE POLICY "Users can insert their own profile"
ON public.users
FOR INSERT
WITH CHECK (
  auth.uid() = auth_user_id
  AND lower(email) = lower(auth.email())
);

CREATE POLICY "Users can view their own profile"
ON public.users
FOR SELECT
USING (auth.uid() = auth_user_id);

CREATE POLICY "Users can update their own profile"
ON public.users
FOR UPDATE
USING (auth.uid() = auth_user_id);

-- Replace overly broad RLS policies on user_topics
DROP POLICY IF EXISTS "Anyone can insert user topics" ON public.user_topics;
DROP POLICY IF EXISTS "Anyone can view user topics" ON public.user_topics;
DROP POLICY IF EXISTS "Anyone can update user topics" ON public.user_topics;
DROP POLICY IF EXISTS "Anyone can delete user topics" ON public.user_topics;

CREATE POLICY "Users can insert their own topics"
ON public.user_topics
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = user_topics.user_id
      AND u.auth_user_id = auth.uid()
  )
);

CREATE POLICY "Users can view their own topics"
ON public.user_topics
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = user_topics.user_id
      AND u.auth_user_id = auth.uid()
  )
);

CREATE POLICY "Users can update their own topics"
ON public.user_topics
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = user_topics.user_id
      AND u.auth_user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete their own topics"
ON public.user_topics
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = user_topics.user_id
      AND u.auth_user_id = auth.uid()
  )
);

-- Newsletter feedback table
CREATE TABLE IF NOT EXISTS public.newsletter_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  issue_date DATE,
  rating TEXT NOT NULL CHECK (rating IN ('good', 'average', 'bad')),
  message TEXT
);

ALTER TABLE public.newsletter_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert feedback"
ON public.newsletter_feedback
FOR INSERT
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_newsletter_feedback_issue_date ON public.newsletter_feedback(issue_date);

-- Pending registrations for cross-device email verification
CREATE TABLE IF NOT EXISTS public.pending_registrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  email TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL
);

ALTER TABLE public.pending_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert pending registrations"
ON public.pending_registrations
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update pending registrations"
ON public.pending_registrations
FOR UPDATE
USING (true)
WITH CHECK (true);

CREATE POLICY "Users can view their pending registration"
ON public.pending_registrations
FOR SELECT
USING (lower(email) = lower(auth.email()));

CREATE POLICY "Users can delete their pending registration"
ON public.pending_registrations
FOR DELETE
USING (lower(email) = lower(auth.email()));
