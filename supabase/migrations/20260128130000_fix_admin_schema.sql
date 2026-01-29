-- 1. Add is_admin column to profiles if it doesn't exist
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- 2. Create function to check if current user is admin (Security Definer allows it to bypass RLS)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
DECLARE
  is_admin_val BOOLEAN;
BEGIN
  SELECT is_admin INTO is_admin_val
  FROM public.profiles
  WHERE user_id = auth.uid();
  
  RETURN COALESCE(is_admin_val, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Enable RLS on profiles (ensure it is enabled)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. Update RLS policies for profiles

-- Allow users to read their own profile (including is_admin column)
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" 
ON public.profiles FOR SELECT 
USING (auth.uid() = user_id);

-- Allow admins to read ALL profiles (needed for Admin Dashboard)
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles" 
ON public.profiles FOR SELECT 
USING (public.is_admin());

-- Allow admins to update ALL profiles
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles" 
ON public.profiles FOR UPDATE
USING (public.is_admin());

-- ---------------------------------------------------------
-- IMPORTANT: RUN THIS SEPARATELY TO MAKE YOURSELF AN ADMIN
-- Replace 'your_email@example.com' with your actual email
-- ---------------------------------------------------------
-- UPDATE public.profiles 
-- SET is_admin = TRUE 
-- WHERE id IN (
--     SELECT id FROM auth.users WHERE email = 'your_email@example.com'
-- );
