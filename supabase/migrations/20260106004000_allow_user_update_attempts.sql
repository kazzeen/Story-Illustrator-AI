-- Allow users to update their own image generation attempts
-- This is required for the client to mark an attempt as failed if client-side validation fails.

CREATE POLICY "Users can update their own image generation attempts"
ON public.image_generation_attempts
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
