import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    // path handling: /functions/v1/api-admin/users -> users
    // url.pathname is /functions/v1/api-admin/users
    // We want the part after /api-admin/
    let path = "";
    if (url.pathname.includes("/api-admin/")) {
      path = url.pathname.split("/api-admin/")[1];
    } else {
      // Fallback if accessed directly or differently
      const parts = url.pathname.split("/");
      path = parts[parts.length - 1];
    }
    
    // Normalize path
    if (path.endsWith("/")) path = path.slice(0, -1);

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("user_id", user.id)
      .single();

    if (!profile?.is_admin) {
      return new Response(JSON.stringify({ error: "Forbidden: Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Router
    if (path === "users") {
      const { data: { users }, error } = await supabase.auth.admin.listUsers();
      if (error) throw error;
      
      // Fetch profiles to join
      const { data: profiles } = await supabase.from("profiles").select("*");
      
      // Combine data
      const enrichedUsers = users.map(u => {
        const p = profiles?.find(p => p.user_id === u.id);
        return {
          ...u,
          profile: p
        };
      });

      return new Response(JSON.stringify({ users: enrichedUsers }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    return new Response(JSON.stringify({ error: `Route not found: ${path}` }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
