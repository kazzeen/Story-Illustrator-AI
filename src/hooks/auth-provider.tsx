import { useState, useEffect, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { AuthContext, type AuthContextType, type UserProfile } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile>(null);

  const isMissingProfileError = (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const record = error as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : "";
    if (code === "PGRST116") return true;
    const message = typeof record.message === "string" ? record.message : "";
    const details = typeof record.details === "string" ? record.details : "";
    const combined = `${message} ${details}`.toLowerCase();
    return combined.includes("0 rows") || combined.includes("no rows") || combined.includes("results contain 0 rows");
  };

  const refreshCreditsBalance = async (_userId: string, existingProfile: UserProfile) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;
      const { data, error } = await supabase.functions.invoke("credits", {
        body: { action: "status", limit: 1 },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) {
        // Fallback: If edge function fails, trust profiles table which is synced via trigger
        return;
      }
      if (!data || typeof data !== "object") return;
      const creditsRaw = "credits" in data ? (data as { credits?: unknown }).credits : null;
      if (!creditsRaw || typeof creditsRaw !== "object") return;
      const remainingMonthly =
        "remaining_monthly" in creditsRaw ? Number((creditsRaw as { remaining_monthly?: unknown }).remaining_monthly) : NaN;
      const remainingBonus =
        "remaining_bonus" in creditsRaw ? Number((creditsRaw as { remaining_bonus?: unknown }).remaining_bonus) : NaN;
      const tierRaw = "tier" in creditsRaw ? (creditsRaw as { tier?: unknown }).tier : null;
      const tier = typeof tierRaw === "string" && tierRaw.trim() ? tierRaw.trim() : null;
      const nextSubscriptionTier = tier === "basic" ? "free" : tier;
      if (!Number.isFinite(remainingMonthly) || !Number.isFinite(remainingBonus)) return;
      const nextBalance = Math.max(remainingMonthly + remainingBonus, 0);
      setProfile((prev) => {
        const base = prev ?? existingProfile;
        if (!base) return prev;
        if (base.credits_balance === nextBalance && (nextSubscriptionTier ? base.subscription_tier === nextSubscriptionTier : true)) return base;
        return { ...base, credits_balance: nextBalance, subscription_tier: nextSubscriptionTier ?? base.subscription_tier };
      });
    } catch {
      return;
    }
  };

  const fetchProfile = async (authUser: User) => {
    const userId = authUser.id;
    try {
      const attemptWithCredits = async () => {
        return await supabase
          .from("profiles")
          .select("display_name, avatar_url, preferred_style, credits_balance, subscription_tier")
          .eq("user_id", userId)
          .single();
      };

      const attemptBasic = async () => {
        return await supabase
          .from("profiles")
          .select("display_name, avatar_url, preferred_style")
          .eq("user_id", userId)
          .single();
      };

      const first = await attemptWithCredits();
      if (!first.error) {
        setProfile(first.data);
        await refreshCreditsBalance(userId, first.data);
        return;
      }

      const code = typeof first.error.code === "string" ? first.error.code : "";
      if (isMissingProfileError(first.error)) {
        const displayName =
          typeof authUser.user_metadata === "object" &&
          authUser.user_metadata !== null &&
          "display_name" in (authUser.user_metadata as Record<string, unknown>) &&
          typeof (authUser.user_metadata as Record<string, unknown>).display_name === "string"
            ? String((authUser.user_metadata as Record<string, unknown>).display_name)
            : null;

        await supabase.from("profiles").upsert({ user_id: userId, display_name: displayName }, { onConflict: "user_id" });

        const retried = await attemptWithCredits();
        if (!retried.error) {
          setProfile(retried.data);
          await refreshCreditsBalance(userId, retried.data);
          return;
        }
      }
      if (code === "42703") {
        const fallback = await attemptBasic();
        if (fallback.error) {
          console.error("Error fetching profile:", fallback.error);
          return;
        }
        setProfile(fallback.data);
        await refreshCreditsBalance(userId, fallback.data);
        return;
      }

      console.error("Error fetching profile:", first.error);
    } catch (e) {
      console.error('Exception fetching profile:', e);
    }
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchProfile(session.user);
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`credits:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_credits", filter: `user_id=eq.${user.id}` },
        () => {
          void refreshCreditsBalance(user.id, null);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user);
    }
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
        },
      },
    });
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const value: AuthContextType = { user, session, loading, profile, refreshProfile, signUp, signIn, signOut };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
