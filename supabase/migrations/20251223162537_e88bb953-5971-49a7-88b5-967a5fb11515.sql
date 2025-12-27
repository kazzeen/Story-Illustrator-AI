-- Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  preferred_style TEXT DEFAULT 'cinematic',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create stories table
CREATE TABLE public.stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  original_filename TEXT,
  original_content TEXT,
  status TEXT NOT NULL DEFAULT 'imported' CHECK (status IN ('imported', 'analyzing', 'analyzed', 'generating', 'completed', 'error')),
  art_style TEXT DEFAULT 'cinematic',
  aspect_ratio TEXT DEFAULT '16:9',
  scene_count INTEGER DEFAULT 0,
  word_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create scenes table
CREATE TABLE public.scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  scene_number INTEGER NOT NULL,
  title TEXT,
  summary TEXT,
  original_text TEXT,
  characters TEXT[],
  setting TEXT,
  emotional_tone TEXT,
  image_prompt TEXT,
  image_url TEXT,
  generation_status TEXT DEFAULT 'pending' CHECK (generation_status IN ('pending', 'generating', 'completed', 'error')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create storage bucket for story files and generated images
INSERT INTO storage.buckets (id, name, public) VALUES ('story-files', 'story-files', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('scene-images', 'scene-images', true);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Stories policies
CREATE POLICY "Users can view their own stories" ON public.stories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own stories" ON public.stories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own stories" ON public.stories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own stories" ON public.stories FOR DELETE USING (auth.uid() = user_id);

-- Scenes policies (through story ownership)
CREATE POLICY "Users can view scenes of their stories" ON public.scenes FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = scenes.story_id AND stories.user_id = auth.uid()));
CREATE POLICY "Users can insert scenes to their stories" ON public.scenes FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = scenes.story_id AND stories.user_id = auth.uid()));
CREATE POLICY "Users can update scenes of their stories" ON public.scenes FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = scenes.story_id AND stories.user_id = auth.uid()));
CREATE POLICY "Users can delete scenes of their stories" ON public.scenes FOR DELETE 
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = scenes.story_id AND stories.user_id = auth.uid()));

-- Storage policies for story-files bucket
CREATE POLICY "Users can upload their own story files" ON storage.objects FOR INSERT 
  WITH CHECK (bucket_id = 'story-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view their own story files" ON storage.objects FOR SELECT 
  USING (bucket_id = 'story-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own story files" ON storage.objects FOR DELETE 
  USING (bucket_id = 'story-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage policies for scene-images bucket (public read, authenticated write)
CREATE POLICY "Anyone can view scene images" ON storage.objects FOR SELECT 
  USING (bucket_id = 'scene-images');
CREATE POLICY "Authenticated users can upload scene images" ON storage.objects FOR INSERT 
  WITH CHECK (bucket_id = 'scene-images' AND auth.role() = 'authenticated');
CREATE POLICY "Users can delete their scene images" ON storage.objects FOR DELETE 
  USING (bucket_id = 'scene-images' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create function to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name');
  RETURN NEW;
END;
$$;

-- Trigger for auto-creating profile
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers for updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_stories_updated_at BEFORE UPDATE ON public.stories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_scenes_updated_at BEFORE UPDATE ON public.scenes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();