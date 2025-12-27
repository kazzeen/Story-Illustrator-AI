
-- Add character_states to scenes
ALTER TABLE public.scenes 
ADD COLUMN character_states JSONB DEFAULT '{}'::jsonb;

-- Comment
COMMENT ON COLUMN public.scenes.character_states IS 'Key-value map of character names to their specific state/clothing in this scene';
