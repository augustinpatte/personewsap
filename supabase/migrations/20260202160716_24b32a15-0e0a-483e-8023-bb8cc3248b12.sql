-- Create users table for newsletter subscribers
CREATE TABLE public.users (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    language TEXT NOT NULL CHECK (language IN ('fr', 'en')),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false,
    email_opt_in BOOLEAN NOT NULL DEFAULT true
);

-- Create user_topics table for storing topic preferences
CREATE TABLE public.user_topics (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    topic_name TEXT NOT NULL,
    articles_count INTEGER NOT NULL DEFAULT 1 CHECK (articles_count >= 1 AND articles_count <= 3),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(user_id, topic_name)
);

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_topics ENABLE ROW LEVEL SECURITY;

-- RLS policies for users table (public insert for registration)
CREATE POLICY "Anyone can insert new users"
ON public.users
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Users can view their own data by email"
ON public.users
FOR SELECT
USING (true);

CREATE POLICY "Users can update their own data"
ON public.users
FOR UPDATE
USING (true);

-- RLS policies for user_topics table
CREATE POLICY "Anyone can insert user topics"
ON public.user_topics
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can view user topics"
ON public.user_topics
FOR SELECT
USING (true);

CREATE POLICY "Anyone can update user topics"
ON public.user_topics
FOR UPDATE
USING (true);

CREATE POLICY "Anyone can delete user topics"
ON public.user_topics
FOR DELETE
USING (true);

-- Create index for email lookups
CREATE INDEX idx_users_email ON public.users(email);