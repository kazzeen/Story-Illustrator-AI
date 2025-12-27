
-- Create characters table
CREATE TABLE public.characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  physical_attributes TEXT,
  clothing TEXT,
  accessories TEXT,
  personality TEXT,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view characters of their stories" ON public.characters FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = characters.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can insert characters to their stories" ON public.characters FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = characters.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can update characters of their stories" ON public.characters FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = characters.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can delete characters of their stories" ON public.characters FOR DELETE 
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = characters.story_id AND stories.user_id = auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_characters_updated_at BEFORE UPDATE ON public.characters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
