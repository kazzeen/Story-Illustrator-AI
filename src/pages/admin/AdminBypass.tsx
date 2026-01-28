import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAdmin } from "@/hooks/useAdmin";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export default function AdminBypass() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session: adminSession, bypassLogin } = useAdmin();
  const { session: userSession } = useAuth();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);

  const redirectTo = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const raw = params.get("redirect");
    return raw && raw.startsWith("/") ? raw : "/admin";
  }, [location.search]);

  useEffect(() => {
    if (adminSession) {
      navigate(redirectTo, { replace: true });
    }
  }, [adminSession, navigate, redirectTo]);

  useEffect(() => {
    if (running) return;
    const accessToken = userSession?.access_token ?? "";
    if (!accessToken) return;
    setRunning(true);
    void (async () => {
      try {
        await bypassLogin({ accessToken });
        navigate(redirectTo, { replace: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Bypass failed";
        toast({ title: "Admin bypass failed", description: msg, variant: "destructive" });
        setRunning(false);
      }
    })();
  }, [bypassLogin, navigate, redirectTo, running, toast, userSession?.access_token]);

  const onSignIn = () => {
    navigate(`/auth?mode=signin&redirect=${encodeURIComponent("/admin/bypass?redirect=" + encodeURIComponent(redirectTo))}`);
  };

  const accessToken = userSession?.access_token ?? "";

  const runBypass = async () => {
    if (running) return;
    if (!accessToken) return;
    setRunning(true);
    try {
      await bypassLogin({ accessToken });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bypass failed";
      toast({ title: "Admin bypass failed", description: msg, variant: "destructive" });
      setRunning(false);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-6 py-10 max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>Admin Bypass</CardTitle>
            <CardDescription>
              This is a troubleshooting-only path. It creates an admin session after verifying your admin privileges.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!accessToken ? (
              <>
                <p className="text-sm text-muted-foreground">Sign in as a normal user first, then return here.</p>
                <Button onClick={onSignIn}>Sign In</Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{running ? "Creating admin session…" : "Ready."}</p>
                <Button onClick={() => void runBypass()} variant="secondary" disabled={running}>
                  {running ? "Working…" : "Run bypass"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
