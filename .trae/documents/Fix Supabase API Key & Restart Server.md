I will fix the "non-2xx status code" error by correcting the Supabase API Key configuration in the frontend.

My analysis revealed that the `VITE_SUPABASE_PUBLISHABLE_KEY` in your `.env` file is set to a placeholder value (`sb_publishable_...`) instead of the valid Supabase Anon JWT. This causes the frontend to send invalid credentials, leading to authentication failures when invoking the Edge Functions.

### **1. Update Environment Variables**
I will update `d:\Projects\SIAI Lovable\.env` with the correct **Supabase Anon Key** retrieved from your project (`eyJ...`). This ensures the frontend client initializes correctly and sends valid headers.

### **2. Sync Configuration**
I will push the corrected secrets to the remote Supabase project to ensure the remote environment matches the local configuration.

### **3. Restart Development Server**
I will restart the running `npm run dev` server (Terminal 5) to force it to reload the new environment variables.

This will ensure that when you click "Buy Credits", the request is authenticated properly, allowing the Edge Function to execute and redirect you to Stripe.
