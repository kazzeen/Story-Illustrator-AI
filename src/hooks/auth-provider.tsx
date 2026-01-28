import { useState, useEffect, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { AuthContext, type AuthContextType, type UserProfile } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile>(null);

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  const isAbortedError = (value: unknown) => {
    if (!value) return false;
    if (value instanceof Error) {
      const msg = (value.message || "").toLowerCase();
      return value.name === "AbortError" || msg.includes("aborted") || msg.includes("err_aborted");
    }
    if (isRecord(value)) {
      const name = typeof value.name === "string" ? value.name : "";
      const msg = typeof value.message === "string" ? value.message : "";
      const code = typeof value.code === "string" ? value.code : "";
      const status = typeof value.status === "number" ? value.status : null;
      const msgLower = msg.toLowerCase();
      return name === "AbortError" || code === "ABORTED" || status === 499 || msgLower.includes("request aborted") || msgLower.includes("aborted");
    }
    return false;
  };

  const fetchProfile = async (userId: string) => {
    try {
      const attemptWithCredits = async () => {
        return await supabase
          .from("profiles")
          .select("display_name, avatar_url, preferred_style, credits_balance, subscription_tier, is_admin")
          .eq("user_id", userId)
          .single();
      };

      const attemptBasic = async () => {
        return await supabase
          .from("profiles")
          .select("display_name, avatar_url, preferred_style, is_admin")
          .eq("user_id", userId)
          .single();
      };

      const first = await attemptWithCredits();
      if (!first.error) {
        setProfile(first.data);
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token ?? null;
          if (token) {
            const { data: creditsData, error: creditsErr } = await supabase.functions.invoke("credits", {
              body: { action: "status", limit: 0 },
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!creditsErr && isRecord(creditsData) && creditsData.success === true && isRecord(creditsData.credits)) {
              const tier = typeof creditsData.credits.tier === "string" ? creditsData.credits.tier : null;
              const remainingMonthly =
                typeof creditsData.credits.remaining_monthly === "number" ? creditsData.credits.remaining_monthly : null;
              const remainingBonus =
                typeof creditsData.credits.remaining_bonus === "number" ? creditsData.credits.remaining_bonus : null;
              const computedBalance =
                typeof remainingMonthly === "number" && typeof remainingBonus === "number"
                  ? Math.max(remainingMonthly + remainingBonus, 0)
                  : null;

              setProfile((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  ...(tier !== null ? { subscription_tier: tier } : {}),
                  ...(computedBalance !== null ? { credits_balance: computedBalance } : {}),
                };
              });
            }
          }
        } catch (e) {
          if (!isAbortedError(e)) console.error("Failed to refresh credits status:", e);
        }
        return;
      }

      const code = typeof first.error.code === "string" ? first.error.code : "";
      if (code === "42703") {
        const fallback = await attemptBasic();
        if (fallback.error) {
          if (!isAbortedError(fallback.error)) console.error("Error fetching profile:", fallback.error);
          return;
        }
        setProfile(fallback.data);
        return;
      }

      if (!isAbortedError(first.error)) console.error("Error fetching profile:", first.error);
    } catch (e) {
      if (!isAbortedError(e)) console.error('Exception fetching profile:', e);
    }
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchProfile(session.user.id);
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
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
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
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Error signing out:", error);
    } finally {
      // Force clear local state
      setSession(null);
      setUser(null);
      setProfile(null);
    }
  };

  const value: AuthContextType = { user, session, loading, profile, refreshProfile, signUp, signIn, signOut };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
