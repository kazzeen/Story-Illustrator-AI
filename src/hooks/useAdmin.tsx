import { useContext } from "react";
import { AdminContext } from "./admin-context";

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (ctx) return ctx;
  return {
    loading: false,
    session: null,
    refreshSession: async () => {},
    login: async () => {
      throw new Error("AdminProvider is missing");
    },
    ssoLogin: async () => {
      throw new Error("AdminProvider is missing");
    },
    bypassLogin: async () => {
      throw new Error("AdminProvider is missing");
    },
    logout: async () => {},
  };
}
