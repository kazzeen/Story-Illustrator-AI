import { useState, useEffect, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { AuthContext, type AuthContextType, type UserProfile } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile>(null);

  const fetchProfile = async (userId: string) => {
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
        return;
      }

      const code = typeof first.error.code === "string" ? first.error.code : "";
      if (code === "42703") {
        const fallback = await attemptBasic();
        if (fallback.error) {
          console.error("Error fetching profile:", fallback.error);
          return;
        }
        setProfile(fallback.data);
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
    await supabase.auth.signOut();
  };

  const value: AuthContextType = { user, session, loading, profile, refreshProfile, signUp, signIn, signOut };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
