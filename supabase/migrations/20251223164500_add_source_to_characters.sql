
-- Add source column to characters table
ALTER TABLE public.characters 
ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto'));

-- Add comment
COMMENT ON COLUMN public.characters.source IS 'Source of the character entry: manual (user added) or auto (AI extracted)';
