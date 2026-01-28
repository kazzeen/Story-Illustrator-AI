import { ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAdmin } from "@/hooks/useAdmin";
import { useAuth } from "@/hooks/useAuth";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { loading, session, refreshSession } = useAdmin();
  const { session: userSession, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const enabled = String(import.meta.env.VITE_ADMIN_UI_ENABLED ?? "true").toLowerCase() !== "false";
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      setChecking(true);
      try {
        await refreshSession();
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshSession]);

  useEffect(() => {
    if (!enabled) return;
    if (loading || checking || authLoading) return;
    if (session) return;

    const isAdminProfile = Boolean(profile && typeof profile === "object" && profile?.is_admin === true);
    const hasUserToken = Boolean(userSession?.access_token);
    const dest = encodeURIComponent(location.pathname + location.search);
    if (isAdminProfile && hasUserToken) {
      navigate(`/admin/bypass?redirect=${dest}`, { replace: true });
      return;
    }
    navigate(`/admin/login?redirect=${dest}`, { replace: true });
  }, [enabled, loading, checking, authLoading, session, navigate, location.pathname, location.search, profile, userSession?.access_token]);

  if (!enabled) return null;
  if (loading || checking || authLoading) return null;
  if (!session) return null;
  return <>{children}</>;
}
