-- CLIPFORGE PostgreSQL / Supabase Migration
-- Includes tables, indexes, and strict Row-Level Security (RLS)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_file TEXT,
  source_url TEXT,
  duration NUMERIC NOT NULL DEFAULT 0,
  resolution TEXT,
  status TEXT NOT NULL DEFAULT 'Uploaded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_time NUMERIC NOT NULL,
  end_time NUMERIC NOT NULL,
  transcript TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Highlight',
  ai_score NUMERIC NOT NULL DEFAULT 0,
  caption_preset TEXT NOT NULL DEFAULT 'CINEMATIC',
  aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  output_file TEXT,
  status TEXT NOT NULL DEFAULT 'Completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  clip_id UUID REFERENCES public.clips(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Queued',
  progress NUMERIC,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  default_caption_style TEXT NOT NULL DEFAULT 'CINEMATIC',
  default_aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  default_clip_length TEXT NOT NULL DEFAULT '30-45',
  export_resolution TEXT NOT NULL DEFAULT '1080p',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row-Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies: users access only their own rows
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users manage own projects" ON public.projects FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own clips" ON public.clips FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users view own jobs" ON public.processing_jobs FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own settings" ON public.user_settings FOR ALL USING (auth.uid() = user_id);

-- Private Storage Bucket (never public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('clipforge-videos', 'clipforge-videos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users access own storage folder"
ON storage.objects FOR ALL
USING (bucket_id = 'clipforge-videos' AND auth.uid()::text = (storage.foldername(name))[1]);
