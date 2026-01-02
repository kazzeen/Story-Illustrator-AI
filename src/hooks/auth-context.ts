import { createContext, useContext } from 'react';
import type { User, Session } from '@supabase/supabase-js';

export type UserProfile = {
  display_name: string | null;
  avatar_url: string | null;
  preferred_style: string | null;
  credits_balance?: number | null;
  subscription_tier?: string | null;
} | null;

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: UserProfile;
  refreshProfile: () => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
