import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, PATCH, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    // path handling: /functions/v1/api-admin/users -> users
    // /functions/v1/api-admin/users/123 -> users/123
    let path = "";
    if (url.pathname.includes("/api-admin/")) {
      path = url.pathname.split("/api-admin/")[1];
    } else {
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
    
    // LIST USERS
    if (path === "users" && req.method === "GET") {
      const { data: { users }, error } = await supabase.auth.admin.listUsers();
      if (error) throw error;
      
      const { data: profiles } = await supabase.from("profiles").select("*");
      
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
    
    // GET USER DETAILS (path: users/:id)
    if (path.startsWith("users/") && req.method === "GET") {
      const userId = path.split("/")[1];
      
      const { data: { user: targetUser }, error: targetUserError } = await supabase.auth.admin.getUserById(userId);
      if (targetUserError) throw targetUserError;
      
      const { data: targetProfile, error: targetProfileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .single();
        
      if (targetProfileError) throw targetProfileError;
      
      // Fetch credit transactions
      const { data: transactions } = await supabase
        .from("credit_transactions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
        
      return new Response(JSON.stringify({
        user: {
          ...targetUser,
          profile: targetProfile,
          transactions: transactions || []
        }
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // UPDATE USER PROFILE (path: users/:id)
    if (path.startsWith("users/") && req.method === "PATCH") {
      const userId = path.split("/")[1];
      const body = await req.json();

      // Update subscription_tier on profiles table
      if (body.subscription_tier !== undefined) {
        const { error: tierError } = await supabase
          .from("profiles")
          .update({ subscription_tier: body.subscription_tier })
          .eq("user_id", userId);
        if (tierError) throw tierError;
      }

      // Adjust credits via the proper credit system (user_credits table + transaction log)
      if (typeof body.credits_balance === "number") {
        // Ensure user has a credits row
        try {
          await supabase.rpc("ensure_user_credits", { p_user_id: userId });
        } catch (_e) { /* RPC may not exist yet, continue */ }

        // Read current balance from user_credits
        const { data: currentCredits } = await supabase
          .from("user_credits")
          .select("monthly_credits_per_cycle, monthly_credits_used, bonus_credits_total, bonus_credits_used, reserved_monthly, reserved_bonus")
          .eq("user_id", userId)
          .maybeSingle();

        if (currentCredits) {
          const reservedMonthly = typeof currentCredits.reserved_monthly === "number" ? currentCredits.reserved_monthly : 0;
          const reservedBonus = typeof currentCredits.reserved_bonus === "number" ? currentCredits.reserved_bonus : 0;
          const remainingMonthly = Math.max(currentCredits.monthly_credits_per_cycle - currentCredits.monthly_credits_used - reservedMonthly, 0);
          const remainingBonus = Math.max(currentCredits.bonus_credits_total - currentCredits.bonus_credits_used - reservedBonus, 0);
          const currentBalance = remainingMonthly + remainingBonus;
          const delta = body.credits_balance - currentBalance;

          if (delta !== 0) {
            const { error: adjErr } = await supabase.rpc("admin_adjust_bonus_credits", {
              p_user_id: userId,
              p_amount: delta,
              p_reason: `Admin adjustment: set balance to ${body.credits_balance}`,
              p_metadata: { adjusted_by: user.id, previous_balance: currentBalance, new_balance: body.credits_balance },
              p_created_by: user.id,
            });
            if (adjErr) throw adjErr;
          }
        } else {
          // No user_credits row — fall back to updating profiles directly
          const { error: fallbackErr } = await supabase
            .from("profiles")
            .update({ credits_balance: body.credits_balance })
            .eq("user_id", userId);
          if (fallbackErr) throw fallbackErr;
        }

        // Sync profiles.credits_balance for display consistency
        const { data: updatedCredits } = await supabase
          .from("user_credits")
          .select("monthly_credits_per_cycle, monthly_credits_used, bonus_credits_total, bonus_credits_used, reserved_monthly, reserved_bonus")
          .eq("user_id", userId)
          .maybeSingle();

        if (updatedCredits) {
          const rm = typeof updatedCredits.reserved_monthly === "number" ? updatedCredits.reserved_monthly : 0;
          const rb = typeof updatedCredits.reserved_bonus === "number" ? updatedCredits.reserved_bonus : 0;
          const newBalance = Math.max(updatedCredits.monthly_credits_per_cycle - updatedCredits.monthly_credits_used - rm, 0)
            + Math.max(updatedCredits.bonus_credits_total - updatedCredits.bonus_credits_used - rb, 0);
          await supabase
            .from("profiles")
            .update({ credits_balance: newBalance })
            .eq("user_id", userId);
        }
      }

      // Return updated profile
      const { data: updatedProfile, error: fetchError } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .single();
      if (fetchError) throw fetchError;

      return new Response(JSON.stringify({ profile: updatedProfile }), {
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
