
-- Add user feedback columns to scenes
ALTER TABLE public.scenes
ADD COLUMN user_rating INTEGER CHECK (user_rating >= 1 AND user_rating <= 5),
ADD COLUMN user_feedback TEXT;

-- Create table to track prompt optimizations for the framework feedback loop
CREATE TABLE public.prompt_optimizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id UUID REFERENCES public.scenes(id) ON DELETE CASCADE,
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  original_input TEXT,
  optimized_prompt JSONB, -- Stores the structured prompt (subject, style, etc.)
  final_prompt_text TEXT,
  framework_version TEXT NOT NULL,
  model_used TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.prompt_optimizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view prompt optimizations of their stories" ON public.prompt_optimizations FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = prompt_optimizations.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can insert prompt optimizations to their stories" ON public.prompt_optimizations FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = prompt_optimizations.story_id AND stories.user_id = auth.uid()));

CREATE INDEX prompt_optimizations_scene_id_idx ON public.prompt_optimizations (scene_id);
