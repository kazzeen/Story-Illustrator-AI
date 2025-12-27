
-- Add consistency_settings to stories
ALTER TABLE public.stories 
ADD COLUMN consistency_settings JSONB DEFAULT '{"mode": "strict", "auto_correct": true}'::jsonb;

-- Create consistency_logs table
CREATE TABLE public.consistency_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  scene_id UUID REFERENCES public.scenes(id) ON DELETE SET NULL,
  check_type TEXT NOT NULL, -- 'prompt_generation', 'image_validation'
  status TEXT NOT NULL, -- 'pass', 'warn', 'fail'
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS for logs
ALTER TABLE public.consistency_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view consistency logs of their stories" ON public.consistency_logs FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = consistency_logs.story_id AND stories.user_id = auth.uid()));

-- No insert policy needed for client as these are system generated, but if needed:
-- CREATE POLICY "Users can insert consistency logs" ...
