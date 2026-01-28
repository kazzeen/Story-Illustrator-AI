 import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAdmin } from "@/hooks/useAdmin";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, ssoLogin, bypassLogin, session } = useAdmin();
  const { user, profile, session: userSession, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [username, setUsername] = useState("admin@siai.com");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const autoBypassAttempted = useRef(false);
  const isAdminProfile = Boolean(profile && typeof profile === "object" && profile?.is_admin === true);
  const isKasseen = user?.email === "kasseen@gmail.com";
  const isAuthorizedAdmin = isAdminProfile || isKasseen;
  const checkingAccess = Boolean(user && profile === null && authLoading === false);

  const cooldownSeconds = useMemo(() => {
    if (cooldownUntil == null) return 0;
    return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  }, [cooldownUntil]);

  const applyRateLimitCooldown = useCallback((err: unknown) => {
    if (!err || typeof err !== "object") return false;
    const status = (err as { status?: unknown }).status;
    const body = (err as { body?: unknown }).body;
    if (status !== 429) return false;
    const retryAfterSeconds =
      body && typeof body === "object" && typeof (body as { retryAfterSeconds?: unknown }).retryAfterSeconds === "number"
        ? Math.max(1, Math.round((body as { retryAfterSeconds: number }).retryAfterSeconds))
        : 60;
    setCooldownUntil(Date.now() + retryAfterSeconds * 1000);
    return true;
  }, []);

  const redirectTo = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const raw = params.get("redirect");
    return raw && raw.startsWith("/") ? raw : "/admin";
  }, [location.search]);

  const onBypass = useCallback(async () => {
    if (submitting) return;
    if (cooldownSeconds > 0) {
      toast({ title: "Please wait", description: `Too many attempts. Try again in ${cooldownSeconds}s.`, variant: "destructive" });
      return;
    }
    const accessToken = userSession?.access_token ?? "";
    if (!accessToken) {
      toast({ title: "Not signed in", description: "Sign in as a normal user first, then try again.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await bypassLogin({ accessToken });
    } catch (err) {
      applyRateLimitCooldown(err);
      const msg = err instanceof Error ? err.message : "Bypass failed";
      toast({ title: "Admin bypass failed", description: msg, variant: "destructive" });
      setSubmitting(false);
    }
  }, [submitting, cooldownSeconds, userSession?.access_token, bypassLogin, toast, applyRateLimitCooldown]);

  useEffect(() => {
    if (session) {
      navigate(redirectTo, { replace: true });
    }
  }, [session, navigate, redirectTo]);

  useEffect(() => {
    if (!isAuthorizedAdmin) return;
    if (session) return;
    if (submitting) return;
    if (autoBypassAttempted.current) return;
    const accessToken = userSession?.access_token ?? "";
    if (!accessToken) return;
    autoBypassAttempted.current = true;
    void onBypass();
  }, [isAuthorizedAdmin, session, submitting, userSession?.access_token, onBypass]);

  const onSso = async () => {
    if (submitting) return;
    if (cooldownSeconds > 0) {
      toast({ title: "Please wait", description: `Too many attempts. Try again in ${cooldownSeconds}s.`, variant: "destructive" });
      return;
    }
    const accessToken = userSession?.access_token ?? "";
    if (!accessToken) {
      toast({ title: "Not signed in", description: "Sign in as a normal user first, then try again.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await ssoLogin({ accessToken });
      // Navigation is handled by session effect
    } catch (err) {
      applyRateLimitCooldown(err);
      const msg = err instanceof Error ? err.message : "Login failed";
      toast({ title: "Admin login failed", description: msg, variant: "destructive" });
      setSubmitting(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (cooldownSeconds > 0) {
      toast({ title: "Please wait", description: `Too many attempts. Try again in ${cooldownSeconds}s.`, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const normalizedUsername = username.trim().toLowerCase();
      await login({ username: normalizedUsername, password });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      applyRateLimitCooldown(err);
      const status = err && typeof err === "object" ? (err as { status?: unknown }).status : null;
      const body = err && typeof err === "object" ? (err as { body?: unknown }).body : null;
      const isInvalidCreds =
        status === 401 && body && typeof body === "object" && (body as { error?: unknown }).error === "invalid_credentials";

      if (isInvalidCreds) {
        toast({
          title: "Invalid admin password",
          description:
            "The admin dashboard password is separate from your normal Supabase user password. Use “Continue as kasseen@gmail.com” (SSO) or sign in with the dedicated admin account/password.",
          variant: "destructive",
        });
      } else {
        const msg = err instanceof Error ? err.message : "Login failed";
        toast({ title: "Admin login failed", description: msg, variant: "destructive" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!session && !isAuthorizedAdmin && checkingAccess) {
    return (
      <Layout>
        <div className="container mx-auto px-6 py-10 max-w-xl text-center">
          <Card>
            <CardHeader>
              <CardTitle>Checking Access</CardTitle>
              <CardDescription>Verifying your admin privileges…</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Please wait.</p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  if (!session && !isAuthorizedAdmin) {
    return (
      <Layout>
        <div className="container mx-auto px-6 py-10 max-w-xl text-center">
          <Card>
            <CardHeader>
              <CardTitle>Restricted Access</CardTitle>
              <CardDescription>
                The admin dashboard is only available to authorized accounts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {user ? (
                <p className="text-muted-foreground">
                  You are signed in as <strong>{user.email}</strong>, which is not an authorized admin account.
                </p>
              ) : (
                <div className="space-y-4">
                  <p className="text-muted-foreground">Please sign in with an authorized account to continue.</p>
                  <Button variant="default" onClick={() => navigate(`/auth?mode=signin&redirect=${encodeURIComponent(`/admin/bypass?redirect=${encodeURIComponent(redirectTo)}`)}`)}>
                    Sign In
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-6 py-10 max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>Admin Login</CardTitle>
            <CardDescription>Sign in to access administrative tools.</CardDescription>
          </CardHeader>
          <CardContent>
            {user?.email ? (
              <div className="space-y-3 mb-6">
                <Button type="button" className="w-full" variant="secondary" onClick={onSso} disabled={submitting || cooldownSeconds > 0}>
                  {submitting ? "Signing in…" : cooldownSeconds > 0 ? `Try again in ${cooldownSeconds}s` : `Continue as ${user.email}`}
                </Button>
                <Button type="button" className="w-full" variant="outline" onClick={onBypass} disabled={submitting || cooldownSeconds > 0}>
                  {submitting ? "Signing in…" : cooldownSeconds > 0 ? `Try again in ${cooldownSeconds}s` : "Bypass (admin-only)"}
                </Button>
                {isKasseen ? (
                  <Button
                    type="button"
                    className="w-full"
                    variant="ghost"
                    onClick={() => setShowPasswordLogin((v) => !v)}
                    disabled={submitting}
                  >
                    {showPasswordLogin ? "Hide password login" : "Use password login instead"}
                  </Button>
                ) : (
                  <div className="text-center text-sm text-muted-foreground">or</div>
                )}
              </div>
            ) : null}
            {!isKasseen || showPasswordLogin ? (
              <form className="space-y-4" onSubmit={onSubmit}>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Admin Email</label>
                  <Input
                    type="email"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="email"
                  />
                  <p className="text-xs text-muted-foreground">
                    This is a separate admin account password (not your normal Supabase user password). If you are signed in as kasseen@gmail.com,
                    prefer “Continue as kasseen@gmail.com”.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Password</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Signing in…" : "Sign In"}
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
