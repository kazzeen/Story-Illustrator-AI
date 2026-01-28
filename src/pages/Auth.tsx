import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToastAction } from "@/components/ui/toast";
import { BookOpen, Sparkles, Loader2, Mail, Lock, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from "@/integrations/supabase/client";
import { z } from 'zod';

const emailSchema = z.string().email('Please enter a valid email address');
const passwordSchema = z.string().min(6, 'Password must be at least 6 characters');

export default function Auth() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const { user, signUp, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      if (isSignUp) return;
      const params = new URLSearchParams(location.search);
      const redirectRaw = params.get("redirect");
      const redirect = redirectRaw && redirectRaw.startsWith("/") ? redirectRaw : "/";
      const forwardKeys = ["purchase_kind", "purchase_tier", "purchase_interval", "purchase_pack"];
      let target = redirect;
      try {
        const url = new URL(redirect, window.location.origin);
        for (const key of forwardKeys) {
          const value = params.get(key);
          if (value) url.searchParams.set(key, value);
        }
        const search = url.searchParams.toString();
        target = `${url.pathname}${search ? `?${search}` : ""}${url.hash ?? ""}`;
      } catch {
        const forwarded = new URLSearchParams();
        for (const key of forwardKeys) {
          const value = params.get(key);
          if (value) forwarded.set(key, value);
        }
        if (forwarded.toString()) {
          target = redirect.includes("?") ? `${redirect}&${forwarded.toString()}` : `${redirect}?${forwarded.toString()}`;
        }
      }
      navigate(target, { replace: true });
    }
  }, [isSignUp, location.search, navigate, user]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const mode = params.get("mode");
    if (mode === "signup") setIsSignUp(true);
    if (mode === "signin") setIsSignUp(false);
  }, [location.search]);

  const validateForm = () => {
    const newErrors: { email?: string; password?: string } = {};
    
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      newErrors.email = emailResult.error.errors[0].message;
    }

    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success) {
      newErrors.password = passwordResult.error.errors[0].message;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    setIsLoading(true);

    try {
      if (isSignUp) {
        const emailRedirectTo = `${window.location.origin}/auth?mode=signin`;
        const resend = async () => {
          const { error: resendErr } = await supabase.auth.resend({
            type: "signup",
            email,
            options: { emailRedirectTo },
          });
          if (resendErr) {
            toast({ title: "Could not resend email", description: resendErr.message, variant: "destructive" });
            return;
          }
          toast({ title: "Email resent", description: "Check your inbox (and spam) for the activation link." });
        };

        const { error, sessionCreated, resendError } = await signUp(email, password, displayName);
        if (error) {
          if (error.message.includes('already registered')) {
            toast({
              title: 'Account exists',
              description: 'This email is already registered. Please sign in instead.',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Sign up failed',
              description: error.message,
              variant: 'destructive',
            });
          }
        } else {
          if (sessionCreated) {
            const details = resendError ? ` Also: ${resendError.message}` : "";
            toast({
              title: "Email verification is not enabled",
              description:
                `Supabase is signing users in immediately on signup. Turn on Confirm Email in Supabase Auth settings to require activation.${details}`,
              variant: "destructive",
            });
          } else {
            if (resendError) {
              toast({
                title: "Account created, but email failed to send",
                description: resendError.message,
                variant: "destructive",
                action: (
                  <ToastAction altText="Resend activation email" onClick={() => void resend()}>
                    Resend
                  </ToastAction>
                ),
              });
            } else {
              toast({
                title: "Check your email",
                description: "Click the activation link we sent you, then come back and sign in.",
                action: (
                  <ToastAction altText="Resend activation email" onClick={() => void resend()}>
                    Resend
                  </ToastAction>
                ),
              });
            }
          }
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          if (error.message.includes("Email not confirmed")) {
            const emailRedirectTo = `${window.location.origin}/auth?mode=signin`;
            toast({
              title: 'Email not confirmed',
              description: 'Please check your email and click the activation link to sign in.',
              variant: 'destructive',
              action: (
                <ToastAction
                  altText="Resend verification email"
                  onClick={() => {
                    void (async () => {
                      const { error: resendErr } = await supabase.auth.resend({
                        type: "signup",
                        email,
                        options: { emailRedirectTo },
                      });
                      if (resendErr) {
                        toast({ title: "Could not resend email", description: resendErr.message, variant: "destructive" });
                        return;
                      }
                      toast({ title: "Email resent", description: "Check your inbox (and spam) for the activation link." });
                    })();
                  }}
                >
                  Resend
                </ToastAction>
              ),
            });
          } else {
            toast({
              title: 'Sign in failed',
              description: 'Invalid email or password. Please try again.',
              variant: 'destructive',
            });
          }
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-accent/20 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center shadow-glow">
              <BookOpen className="w-6 h-6 text-primary-foreground" />
            </div>
            <Sparkles className="w-4 h-4 text-primary animate-pulse" />
          </div>
          <h1 className="font-display text-3xl font-bold text-foreground">SIAI</h1>
          <p className="text-muted-foreground mt-2">Story Illustrator AI</p>
        </div>

        <Card variant="glass" className="border-border/50">
          <CardHeader className="text-center">
            <CardTitle className="font-display text-2xl">
              {isSignUp ? 'Create Account' : 'Welcome Back'}
            </CardTitle>
            <CardDescription>
              {isSignUp 
                ? 'Start transforming your stories into visual masterpieces' 
                : 'Sign in to continue your creative journey'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="displayName"
                      type="text"
                      placeholder="Your name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setErrors((prev) => ({ ...prev, email: undefined }));
                    }}
                    className="pl-10"
                  />
                </div>
                {errors.email && (
                  <p className="text-sm text-destructive">{errors.email}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setErrors((prev) => ({ ...prev, password: undefined }));
                    }}
                    className="pl-10"
                  />
                </div>
                {errors.password && (
                  <p className="text-sm text-destructive">{errors.password}</p>
                )}
              </div>

              <Button
                type="submit"
                variant="hero"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {isSignUp ? 'Creating Account...' : 'Signing In...'}
                  </>
                ) : (
                  isSignUp ? 'Create Account' : 'Sign In'
                )}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-muted-foreground">
                {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(!isSignUp);
                    setErrors({});
                  }}
                  className="text-primary hover:underline font-medium"
                >
                  {isSignUp ? 'Sign In' : 'Sign Up'}
                </button>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
