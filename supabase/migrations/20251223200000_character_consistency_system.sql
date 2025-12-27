
-- Story-level style guide versions
CREATE TABLE public.story_style_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'archived')),
  guide JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  parent_id UUID REFERENCES public.story_style_guides(id) ON DELETE SET NULL,
  UNIQUE (story_id, version)
);

ALTER TABLE public.story_style_guides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view style guides of their stories" ON public.story_style_guides FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = story_style_guides.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can insert style guides to their stories" ON public.story_style_guides FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = story_style_guides.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can update style guides of their stories" ON public.story_style_guides FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = story_style_guides.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can delete style guides of their stories" ON public.story_style_guides FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = story_style_guides.story_id AND stories.user_id = auth.uid()));

CREATE INDEX story_style_guides_story_id_idx ON public.story_style_guides (story_id);

CREATE TRIGGER update_story_style_guides_updated_at BEFORE UPDATE ON public.story_style_guides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.stories
  ADD COLUMN active_style_guide_id UUID REFERENCES public.story_style_guides(id) ON DELETE SET NULL;

-- Character reference sheet versions (text + optional reference image)
CREATE TABLE public.character_reference_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'archived')),
  sheet JSONB NOT NULL DEFAULT '{}'::jsonb,
  prompt_snippet TEXT,
  reference_image_url TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  parent_id UUID REFERENCES public.character_reference_sheets(id) ON DELETE SET NULL,
  UNIQUE (character_id, version)
);

ALTER TABLE public.character_reference_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view character reference sheets of their stories" ON public.character_reference_sheets FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = character_reference_sheets.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can insert character reference sheets to their stories" ON public.character_reference_sheets FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = character_reference_sheets.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can update character reference sheets of their stories" ON public.character_reference_sheets FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = character_reference_sheets.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can delete character reference sheets of their stories" ON public.character_reference_sheets FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = character_reference_sheets.story_id AND stories.user_id = auth.uid()));

CREATE INDEX character_reference_sheets_story_id_idx ON public.character_reference_sheets (story_id);
CREATE INDEX character_reference_sheets_character_id_idx ON public.character_reference_sheets (character_id);

CREATE TRIGGER update_character_reference_sheets_updated_at BEFORE UPDATE ON public.character_reference_sheets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.characters
  ADD COLUMN active_reference_sheet_id UUID REFERENCES public.character_reference_sheets(id) ON DELETE SET NULL;

-- Versioned character asset records (approved portraits/outfits/etc.)
CREATE TABLE public.character_asset_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('portrait', 'reference_sheet', 'outfit', 'other')),
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'archived')),
  image_url TEXT,
  prompt TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  parent_id UUID REFERENCES public.character_asset_versions(id) ON DELETE SET NULL,
  UNIQUE (character_id, asset_type, version)
);

ALTER TABLE public.character_asset_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view character assets of their stories" ON public.character_asset_versions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = character_asset_versions.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can insert character assets to their stories" ON public.character_asset_versions FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = character_asset_versions.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can update character assets of their stories" ON public.character_asset_versions FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = character_asset_versions.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can delete character assets of their stories" ON public.character_asset_versions FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = character_asset_versions.story_id AND stories.user_id = auth.uid()));

CREATE INDEX character_asset_versions_story_id_idx ON public.character_asset_versions (story_id);
CREATE INDEX character_asset_versions_character_id_idx ON public.character_asset_versions (character_id);

-- Normalized per-scene character state tracking
CREATE TABLE public.scene_character_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  scene_id UUID NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual', 'validated')),
  story_context TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (scene_id, character_id)
);

ALTER TABLE public.scene_character_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view scene character states of their stories" ON public.scene_character_states FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = scene_character_states.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can insert scene character states to their stories" ON public.scene_character_states FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = scene_character_states.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can update scene character states of their stories" ON public.scene_character_states FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = scene_character_states.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can delete scene character states of their stories" ON public.scene_character_states FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = scene_character_states.story_id AND stories.user_id = auth.uid()));

CREATE INDEX scene_character_states_story_id_idx ON public.scene_character_states (story_id);
CREATE INDEX scene_character_states_scene_id_idx ON public.scene_character_states (scene_id);
CREATE INDEX scene_character_states_character_id_idx ON public.scene_character_states (character_id);

CREATE TRIGGER update_scene_character_states_updated_at BEFORE UPDATE ON public.scene_character_states
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-scene validation results + metrics
CREATE TABLE public.scene_consistency_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  scene_id UUID NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  image_url TEXT,
  overall_score NUMERIC,
  status TEXT NOT NULL CHECK (status IN ('pass', 'warn', 'fail')),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.scene_consistency_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view scene consistency metrics of their stories" ON public.scene_consistency_metrics FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = scene_consistency_metrics.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can insert scene consistency metrics to their stories" ON public.scene_consistency_metrics FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = scene_consistency_metrics.story_id AND stories.user_id = auth.uid()));

CREATE INDEX scene_consistency_metrics_story_id_idx ON public.scene_consistency_metrics (story_id);
CREATE INDEX scene_consistency_metrics_scene_id_idx ON public.scene_consistency_metrics (scene_id);

-- Continuity change events between consecutive scenes
CREATE TABLE public.character_change_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  from_scene_id UUID REFERENCES public.scenes(id) ON DELETE SET NULL,
  to_scene_id UUID REFERENCES public.scenes(id) ON DELETE SET NULL,
  character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  event JSONB NOT NULL DEFAULT '{}'::jsonb,
  story_context TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.character_change_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view character change events of their stories" ON public.character_change_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = character_change_events.story_id AND stories.user_id = auth.uid()));

CREATE POLICY "Users can insert character change events to their stories" ON public.character_change_events FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.stories WHERE stories.id = character_change_events.story_id AND stories.user_id = auth.uid()));

CREATE INDEX character_change_events_story_id_idx ON public.character_change_events (story_id);
CREATE INDEX character_change_events_character_id_idx ON public.character_change_events (character_id);

-- Scene-level cache of latest consistency status
ALTER TABLE public.scenes
  ADD COLUMN consistency_score NUMERIC,
  ADD COLUMN consistency_status TEXT CHECK (consistency_status IN ('pass', 'warn', 'fail')),
  ADD COLUMN consistency_details JSONB DEFAULT '{}'::jsonb;

