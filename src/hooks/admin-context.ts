import { createContext } from "react";

export type AdminSession = {
  username: string;
  csrfToken: string | null;
  sessionToken?: string | null;
};

export type AdminContextValue = {
  loading: boolean;
  session: AdminSession | null;
  refreshSession: () => Promise<void>;
  login: (args: { username: string; password: string }) => Promise<void>;
  ssoLogin: (args: { accessToken: string }) => Promise<void>;
  bypassLogin: (args: { accessToken: string }) => Promise<void>;
  logout: () => Promise<void>;
};

export const AdminContext = createContext<AdminContextValue | null>(null);
