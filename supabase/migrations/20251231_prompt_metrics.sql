
-- Add prompt adherence metrics
ALTER TABLE public.scene_consistency_metrics
ADD COLUMN prompt_adherence_score NUMERIC,
ADD COLUMN prompt_adherence_feedback TEXT;

-- Add index for analytics
CREATE INDEX scene_consistency_metrics_adherence_idx ON public.scene_consistency_metrics (prompt_adherence_score);
