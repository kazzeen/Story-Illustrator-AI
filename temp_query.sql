SELECT request_id, user_id, status, error_stage, error_message, credits_amount, created_at 
FROM image_generation_attempts 
WHERE status = 'failed' AND error_message LIKE '%Blank image generation%' 
ORDER BY created_at DESC 
LIMIT 5;