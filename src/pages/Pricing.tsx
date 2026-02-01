import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Check, X, HelpCircle, Zap, Star, Shield, Crown, Sparkles, CheckCircle2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Link, useLocation, useNavigate } from "react-router-dom";

function formatUsd(value: number, locale: string = "en-US") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const redirectToUrl = (url: string) => {
  window.location.assign(url);
};

const plans = [
  {
    name: "Free",
    price: 0,
    description: "Perfect for trying out SIAI",
    features: [
      "5 free onboarding images",
      "1 story generation",
      "Basic models only",
      "Standard support"
    ],
    limitations: [
      "Limited art styles",
      "Watermarked images",
      "No commercial rights"
    ],
    cta: "Start for Free",
    ctaVariant: "outline" as const,
    href: "/auth?mode=signup",
    highlight: false,
    color: "bg-slate-100 dark:bg-slate-900"
  },
  {
    name: "Starter",
    price: 9.99,
    description: "For hobbyists and beginners",
    features: [
      "100 images/credits per month",
      "20 first-time bonus credits",
      "5 story generations",
      "Nano Banana Standard Model",
      "Standard art styles",
      "Commercial rights"
    ],
    cta: "Get Started",
    ctaVariant: "default" as const,
    href: "/auth?mode=signup&plan=starter",
    highlight: false,
    color: "bg-blue-50/50 dark:bg-blue-950/20",
    valueText: "~$0.08 / credit"
  },
  {
    name: "Creator",
    price: 19.99,
    description: "For serious storytellers",
    features: [
      "200 images/credits per month",
      "100 first-time bonus credits",
      "25 story generations",
      "All Models (Nano Banana Pro, Venice.ai)",
      "All Art Styles available",
      "Priority generation queue"
    ],
    cta: "Upgrade to Creator",
    ctaVariant: "hero" as const,
    href: "/auth?mode=signup&plan=creator",
    highlight: true,
    badge: "Popular Choice",
    color: "bg-primary/5 dark:bg-primary/10 border-primary/50",
    valueText: "~$0.06 / credit"
  },
  {
    name: "Professional",
    price: 39.99,
    description: "Power users and studios",
    features: [
      "Unlimited images & stories",
      "All Models & Art Styles",
      "Dedicated support",
      "Custom feature requests",
      "Early access to new features",
      "API Access (beta)"
    ],
    cta: "Go Professional",
    ctaVariant: "default" as const,
    href: "/auth?mode=signup&plan=professional",
    highlight: false,
    badge: "Most Powerful",
    color: "bg-purple-50/50 dark:bg-purple-950/20",
    valueText: "Best Value"
  }
];

const featuresComparison = [
  {
    category: "Generation",
    features: [
      { name: "Monthly Credits", free: "5 (one-time)", starter: "100", creator: "200", pro: "Unlimited" },
      { name: "Story Generations", free: "1", starter: "5", creator: "25", pro: "Unlimited" },
      { name: "Bonus Credits", free: "-", starter: "20", creator: "100", pro: "-" },
    ]
  },
  {
    category: "Capabilities",
    features: [
      { name: "AI Models", free: "Basic", starter: "Nano Banana Std", creator: "All (Pro + Venice)", pro: "All + Future" },
      { name: "Art Styles", free: "Limited", starter: "Standard", creator: "All Styles", pro: "All Styles" },
      { name: "Commercial Usage", free: false, starter: true, creator: true, pro: true },
      { name: "Watermark Free", free: false, starter: true, creator: true, pro: true },
    ]
  },
  {
    category: "Support",
    features: [
      { name: "Support Level", free: "Community", starter: "Standard", creator: "Priority", pro: "Dedicated" },
      { name: "Feature Requests", free: false, starter: false, creator: false, pro: true },
    ]
  }
];

const faqs = [
  {
    question: "How do credits work?",
    answer: "Credits are used to generate images. Different models and quality settings may consume different amounts of credits. Your monthly allowance resets every billing cycle."
  },
  {
    question: "Can I cancel anytime?",
    answer: "Yes, you can cancel your subscription at any time. Your access will continue until the end of your current billing period."
  },
  {
    question: "What happens to unused credits?",
    answer: "For Starter and Creator plans, a portion of unused credits rolls over to the next month, up to a maximum limit equivalent to your monthly allowance."
  },
  {
    question: "What is the difference between Nano Banana Standard and Pro?",
    answer: "Nano Banana Pro offers higher detail, better prompt adherence, and more complex composition capabilities compared to the Standard version."
  }
];

const creditPackages = [
  {
    name: "Small",
    price: 4.99,
    credits: 50,
    description: "Quick top-up for a small project",
    perCredit: "$0.10/credit",
    highlight: false
  },
  {
    name: "Medium",
    price: 14.99,
    credits: 200,
    description: "Best for ongoing stories",
    perCredit: "$0.07/credit",
    highlight: true,
    badge: "Best Value"
  },
  {
    name: "Large",
    price: 24.99,
    credits: 400,
    description: "Maximum bulk savings",
    perCredit: "$0.06/credit",
    highlight: false
  }
];

export default function Pricing() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, session, refreshProfile } = useAuth();
  const [isAnnual, setIsAnnual] = useState(true);
  const [checkoutKey, setCheckoutKey] = useState<string | null>(null);
  const handledCheckoutReturn = useRef(false);
  const handledPurchaseIntent = useRef(false);
  const lastModeScrollRef = useRef<string | null>(null);
  const plansSectionRef = useRef<HTMLDivElement | null>(null);
  const creditsSectionRef = useRef<HTMLDivElement | null>(null);

  const starterCreditCost = formatUsd(isAnnual ? 0.08 : 0.1);

  const calculatePrice = (price: number) => {
    if (price === 0) return "Free";
    if (isAnnual) return `$${(price * 0.8).toFixed(2)}`;
    return `$${price}`;
  };

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const isRecord = useCallback((value: unknown): value is Record<string, unknown> => {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }, []);

  const invokeEdgeFunction = useCallback(async (fn: string, body: Record<string, unknown>, accessToken: string) => {
    const { data, error } = await supabase.functions.invoke(fn, {
      body,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) throw error;
    return data;
  }, []);

  const getErrorStatus = useCallback(
    (err: unknown): number | null => {
      if (!isRecord(err)) return null;
      const direct = typeof err.status === "number" ? Number(err.status) : null;
      const context = isRecord(err.context) ? err.context : null;
      const contextual = context && typeof context.status === "number" ? Number(context.status) : null;
      return contextual ?? direct;
    },
    [isRecord],
  );

  const refreshAccessToken = useCallback(async () => {
    const { data: current } = await supabase.auth.getSession();
    const session = current.session ?? null;
    const token = session?.access_token ?? null;
    const expiresAt = typeof session?.expires_at === "number" ? session.expires_at * 1000 : null;
    const shouldRefresh = expiresAt !== null ? expiresAt - Date.now() < 60_000 : false;
    if (token && !shouldRefresh) return token;

    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (error) return token;
    return refreshed.session?.access_token ?? token;
  }, []);

  const summarizeFunctionError = useCallback(
    (err: unknown) => {
      if (!isRecord(err)) return "Checkout failed";

      const message = typeof err.message === "string" ? String(err.message) : null;
      const status = typeof err.status === "number" ? Number(err.status) : null;
      const context = isRecord(err.context) ? err.context : null;
      const contextStatus = context && typeof context.status === "number" ? Number(context.status) : null;
      const effectiveStatus = contextStatus ?? status;
      const contextBody = context && "body" in context ? (context as Record<string, unknown>).body : null;
      const directBody = "body" in err ? (err as Record<string, unknown>).body : null;
      const body = contextBody ?? directBody;

      let details: string | null = null;
      if (isRecord(body)) {
        const missing = (body as Record<string, unknown>).missing;
        if (Array.isArray(missing) && missing.every((item) => typeof item === "string")) {
          details = `Missing configuration: ${missing.join(", ")}`;
        } else {
          const errorText = typeof (body as Record<string, unknown>).error === "string" ? String((body as Record<string, unknown>).error) : null;
          const detailsText =
            typeof (body as Record<string, unknown>).details === "string" ? String((body as Record<string, unknown>).details) : null;
          if (errorText && detailsText) details = `${errorText}: ${detailsText}`;
          else details = errorText ?? detailsText;
        }
      } else if (typeof body === "string" && body.trim()) {
        details = body.trim();
      }

      const parts: string[] = [];
      if (effectiveStatus) parts.push(`HTTP ${effectiveStatus}`);
      if (details) parts.push(details);
      if (!details && message) parts.push(message);

      const text = parts.length ? parts.join(" - ") : "Checkout failed";
      return text.length > 400 ? `${text.slice(0, 400)}…` : text;
    },
    [isRecord],
  );

  const buildAuthRedirectToPricing = useCallback((purchaseParams?: URLSearchParams) => {
    const next = new URLSearchParams();
    next.set("mode", "signin");
    next.set("redirect", "/pricing");
    if (purchaseParams) {
      purchaseParams.forEach((value, key) => next.set(key, value));
    }
    return `/auth?${next.toString()}`;
  }, []);

  const startCheckout = useCallback(
    async (purchase: URLSearchParams, key: string) => {
      let accessToken = await refreshAccessToken();
      if (!accessToken) {
        toast({
          title: "Sign in required",
          description: "Please sign in to complete your purchase.",
          variant: "destructive",
        });
        navigate(buildAuthRedirectToPricing(purchase));
        return;
      }

      const kind = purchase.get("purchase_kind");
      const tier = purchase.get("purchase_tier");
      const interval = purchase.get("purchase_interval");
      const pack = purchase.get("purchase_pack");
      const returnBase = typeof window !== "undefined" ? window.location.origin : null;

      let fn: string | null = null;
      const body: Record<string, unknown> = {};

      if (returnBase) body.returnBase = returnBase;

      if (kind === "subscription" && (tier === "starter" || tier === "creator" || tier === "professional") && (interval === "month" || interval === "year")) {
        if (tier === "starter") {
          fn = "create-starter-membership-checkout";
          body.interval = interval;
        } else {
          fn = "create-creator-membership-checkout";
          body.tier = tier;
          body.interval = interval;
        }
      } else if (kind === "credits" && (pack === "small" || pack === "medium" || pack === "large")) {
        fn = "create-credit-pack-checkout";
        body.pack = pack;
      }

      if (!fn) {
        toast({ title: "Invalid checkout request", description: "Please try again.", variant: "destructive" });
        return;
      }

      setCheckoutKey(key);
      try {
        let data: unknown;
        try {
          data = await invokeEdgeFunction(fn, body, accessToken);
        } catch (e) {
          console.error("Checkout error:", e);
          const status = (e as any).status || getErrorStatus(e);
          if (status === 401) {
            const refreshed = await refreshAccessToken();
            if (refreshed && refreshed !== accessToken) {
              accessToken = refreshed;
            }
            // Retry once with new session
            data = await invokeEdgeFunction(fn, body, accessToken);
          } else {
            throw e;
          }
        }

        const url =
          isRecord(data) && typeof data.url === "string"
            ? String(data.url)
            : isRecord(data) && isRecord(data.data) && typeof data.data.url === "string"
              ? String((data.data as Record<string, unknown>).url)
              : null;

        if (url) {
          redirectToUrl(url);
        } else {
          const details =
            isRecord(data) && typeof data.error === "string"
              ? data.error
            : isRecord(data) && typeof data.details === "string"
                ? data.details
                : "Missing checkout URL";
          toast({ title: "Checkout failed", description: details, variant: "destructive" });
          return;
        }
      } catch (e: any) {
        console.error("Checkout exception:", e);
        const detailMsg = e.details || e.message || (e instanceof Error ? e.message : "Unknown error");
        toast({ 
            title: "Authorization error", 
            description: detailMsg.includes("401") ? `Checkout authorization failed: ${detailMsg}` : detailMsg, 
            variant: "destructive" 
        });
      } finally {
        setCheckoutKey(null);
      }
    },
    [navigate, toast, refreshAccessToken]
  );

  useEffect(() => {
    const checkout = searchParams.get("checkout") ?? searchParams.get("credits_checkout");
    const sessionId = searchParams.get("session_id");
    if (checkout === "success" && sessionId && user && !handledCheckoutReturn.current) {
      handledCheckoutReturn.current = true;
      (async () => {
        try {
          let accessToken = await refreshAccessToken();
          if (!accessToken) {
            toast({ title: "Checkout complete", description: "Please sign in again to refresh your account.", variant: "destructive" });
            navigate(buildAuthRedirectToPricing());
            return;
          }

          let data: unknown;
          try {
            data = await invokeEdgeFunction("credits", { action: "status", limit: 0 }, accessToken);
          } catch (e) {
            if (getErrorStatus(e) === 401) {
              const refreshed = await refreshAccessToken();
              if (!refreshed || refreshed === accessToken) throw e;
              accessToken = refreshed;
              data = await invokeEdgeFunction("credits", { action: "status", limit: 0 }, accessToken);
            } else {
              throw e;
            }
          }

          if (isRecord(data) && data.success === true) {
            void refreshProfile();
            const tier = isRecord(data.credits) && typeof data.credits.tier === "string" ? String(data.credits.tier) : null;
            const remainingMonthly =
              isRecord(data.credits) && typeof data.credits.remaining_monthly === "number" ? Number(data.credits.remaining_monthly) : null;
            const remainingBonus =
              isRecord(data.credits) && typeof data.credits.remaining_bonus === "number" ? Number(data.credits.remaining_bonus) : null;
            const total =
              typeof remainingMonthly === "number" && typeof remainingBonus === "number"
                ? Math.max(remainingMonthly + remainingBonus, 0)
                : null;
            toast({
              title: "Checkout complete",
              description: total !== null && tier ? `${total} credits (${tier})` : "Your account has been updated.",
            });
          } else {
            toast({ title: "Checkout complete", description: "Your purchase is processing. Refresh in a moment.", variant: "destructive" });
          }
        } catch (e) {
          toast({ title: "Checkout complete", description: summarizeFunctionError(e), variant: "destructive" });
        } finally {
          const next = new URLSearchParams(searchParams);
          next.delete("checkout");
          next.delete("credits_checkout");
          next.delete("session_id");
          navigate({ pathname: "/pricing", search: next.toString() ? `?${next.toString()}` : "" }, { replace: true });
        }
      })();
    }

    if (checkout === "cancel" && !handledCheckoutReturn.current) {
      handledCheckoutReturn.current = true;
      toast({ title: "Checkout canceled", description: "No charges were made." });
      const next = new URLSearchParams(searchParams);
      next.delete("checkout");
      next.delete("credits_checkout");
      next.delete("session_id");
      navigate({ pathname: "/pricing", search: next.toString() ? `?${next.toString()}` : "" }, { replace: true });
    }
  }, [
    buildAuthRedirectToPricing,
    getErrorStatus,
    invokeEdgeFunction,
    isRecord,
    navigate,
    refreshAccessToken,
    refreshProfile,
    searchParams,
    summarizeFunctionError,
    toast,
    user,
  ]);

  useEffect(() => {
    if (!user) return;
    if (handledPurchaseIntent.current) return;
    const kind = searchParams.get("purchase_kind");
    if (!kind) return;
    handledPurchaseIntent.current = true;
    const key = `${kind}:${searchParams.get("purchase_tier") ?? ""}:${searchParams.get("purchase_pack") ?? ""}:${searchParams.get("purchase_interval") ?? ""}`;
    void startCheckout(searchParams, key);
  }, [searchParams, startCheckout, user]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mode = searchParams.get("mode");
    if (mode !== "credits" && mode !== "subscription") return;
    if (lastModeScrollRef.current === mode) return;
    lastModeScrollRef.current = mode;

    const target = mode === "credits" ? creditsSectionRef.current : plansSectionRef.current;
    if (!target) return;

    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [searchParams]);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16 space-y-24">
        {/* Header */}
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <Badge variant="secondary" className="mb-4">
            <Sparkles className="w-3 h-3 mr-1" />
            Simple Pricing
          </Badge>
          <h1 className="font-display text-4xl md:text-5xl font-bold">
            Choose the perfect plan for your story
          </h1>
          <p className="text-xl text-muted-foreground">
            Start for free and upgrade as you grow. Unlock more power, styles, and capabilities.
          </p>
          
          <div className="flex items-center justify-center gap-4 pt-8">
            <span className={cn("text-sm font-medium", !isAnnual && "text-foreground", isAnnual && "text-muted-foreground")}>Monthly</span>
            <Switch
              checked={isAnnual}
              onCheckedChange={setIsAnnual}
            />
            <span className={cn("text-sm font-medium", isAnnual && "text-foreground", !isAnnual && "text-muted-foreground")}>
              Annual <span className="text-green-500 font-bold ml-1">(Save 20%)</span>
            </span>
          </div>
        </div>

        {/* Pricing Cards */}
        <div ref={plansSectionRef} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
          {plans.map((plan) => (
            <Card 
              key={plan.name} 
              className={cn(
                "relative flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-xl",
                plan.highlight ? "border-primary shadow-lg scale-105 z-10" : "border-border"
              )}
            >
              {plan.badge && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground px-4 py-1">
                    {plan.badge}
                  </Badge>
                </div>
              )}
              
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {plan.name}
                  {plan.name === "Professional" && <Crown className="w-5 h-5 text-purple-500" />}
                </CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold">{calculatePrice(plan.price)}</span>
                  {plan.price > 0 && <span className="text-muted-foreground">/mo</span>}
                  {(plan.valueText || plan.name === "Starter") && (
                    <div
                      key={plan.name === "Starter" ? (isAnnual ? "annual" : "monthly") : plan.valueText}
                      className="text-sm text-muted-foreground mt-1 font-medium text-green-600 dark:text-green-400 animate-in fade-in duration-200"
                    >
                      {plan.name === "Starter" ? `${starterCreditCost} per credit` : plan.valueText}
                    </div>
                  )}
                </div>
              </CardHeader>

              <CardContent className="flex-1 space-y-4">
                <div className="space-y-2">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                      <span>{feature}</span>
                    </div>
                  ))}
                  {plan.limitations?.map((limitation) => (
                    <div key={limitation} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <X className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{limitation}</span>
                    </div>
                  ))}
                </div>
              </CardContent>

              <CardFooter>
                {plan.name === "Free" ? (
                  <Button className="w-full" variant={plan.ctaVariant} size="lg" asChild>
                    <Link to={plan.href}>{plan.cta}</Link>
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    variant={plan.ctaVariant}
                    size="lg"
                    disabled={checkoutKey === `plan:${plan.name}`}
                    onClick={() => {
                      const tier = plan.name === "Starter" ? "starter" : plan.name === "Creator" ? "creator" : "professional";
                      const interval = isAnnual ? "year" : "month";
                      const purchase = new URLSearchParams();
                      purchase.set("purchase_kind", "subscription");
                      purchase.set("purchase_tier", tier);
                      purchase.set("purchase_interval", interval);
                      void startCheckout(purchase, `plan:${plan.name}`);
                    }}
                  >
                    {checkoutKey === `plan:${plan.name}` ? "Redirecting..." : plan.cta}
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>

        {/* Credit Packages */}
        <div ref={creditsSectionRef} className="max-w-4xl mx-auto space-y-8">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold mb-4">Need More Credits?</h2>
            <p className="text-muted-foreground">Top up your account with on-demand credit packs. No expiration on purchased credits.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {creditPackages.map((pack) => (
              <Card 
                key={pack.name}
                className={cn(
                  "relative flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-lg",
                  pack.highlight ? "border-primary/50 shadow-md" : "border-border"
                )}
              >
                {pack.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                      {pack.badge}
                    </Badge>
                  </div>
                )}
                <CardHeader className="text-center pb-2">
                  <CardTitle className="text-xl">{pack.name}</CardTitle>
                  <CardDescription>{pack.description}</CardDescription>
                </CardHeader>
                <CardContent className="text-center pb-2">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <span className="text-3xl font-bold">${pack.price}</span>
                  </div>
                  <div className="text-sm font-medium text-muted-foreground mb-4">
                    {pack.credits} Credits
                  </div>
                  <div className="inline-block bg-secondary/50 px-3 py-1 rounded-full text-xs text-muted-foreground">
                    {pack.perCredit}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={checkoutKey === `credits:${pack.credits}`}
                    onClick={() => {
                      const purchase = new URLSearchParams();
                      purchase.set("purchase_kind", "credits");
                      const packKey = pack.credits === 50 ? "small" : pack.credits === 200 ? "medium" : "large";
                      purchase.set("purchase_pack", packKey);
                      void startCheckout(purchase, `credits:${pack.credits}`);
                    }}
                  >
                    {checkoutKey === `credits:${pack.credits}` ? "Redirecting..." : `Buy ${pack.credits} Credits`}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>

        {/* Feature Comparison */}
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold mb-4">Compare Features</h2>
            <p className="text-muted-foreground">Detailed breakdown of what's included in each plan</p>
          </div>
          
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader className="bg-secondary/30">
                <TableRow>
                  <TableHead className="w-[200px]">Feature</TableHead>
                  <TableHead>Free</TableHead>
                  <TableHead>Starter</TableHead>
                  <TableHead className="text-primary font-bold">Creator</TableHead>
                  <TableHead>Professional</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {featuresComparison.map((section) => (
                  <Fragment key={section.category}>
                    <TableRow className="bg-secondary/10 hover:bg-secondary/10">
                      <TableCell colSpan={5} className="font-semibold text-muted-foreground pl-4 py-2">
                        {section.category}
                      </TableCell>
                    </TableRow>
                    {section.features.map((feature) => (
                      <TableRow key={feature.name}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {feature.name}
                            <Tooltip>
                              <TooltipTrigger>
                                <HelpCircle className="w-3 h-3 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Details about {feature.name}</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                        <TableCell>
                          {typeof feature.free === "boolean" ? (
                            feature.free ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-muted-foreground" />
                          ) : feature.free}
                        </TableCell>
                        <TableCell>
                          {typeof feature.starter === "boolean" ? (
                            feature.starter ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-muted-foreground" />
                          ) : feature.starter}
                        </TableCell>
                        <TableCell className="bg-primary/5">
                          {typeof feature.creator === "boolean" ? (
                            feature.creator ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-muted-foreground" />
                          ) : feature.creator}
                        </TableCell>
                        <TableCell>
                          {typeof feature.pro === "boolean" ? (
                            feature.pro ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-muted-foreground" />
                          ) : feature.pro}
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Testimonials */}
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {[
            {
              quote: "The character consistency is mind-blowing. It saved me weeks of work on my graphic novel.",
              author: "Sarah J.",
              role: "Indie Author"
            },
            {
              quote: "Finally, an AI tool that actually understands story continuity. The Creator tier is worth every penny.",
              author: "Mike R.",
              role: "Storyboard Artist"
            },
            {
              quote: "I use the Professional plan for my studio. The dedicated support and API access have streamlined our workflow.",
              author: "Elena V.",
              role: "Creative Director"
            }
          ].map((testimonial) => (
            <Card key={testimonial.author} className="bg-secondary/20 border-none">
              <CardContent className="pt-6">
                <div className="flex gap-1 mb-4">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                  ))}
                </div>
                <p className="mb-4 italic">"{testimonial.quote}"</p>
                <div>
                  <p className="font-semibold">{testimonial.author}</p>
                  <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="font-display text-3xl font-bold mb-4">Frequently Asked Questions</h2>
          </div>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq) => (
              <AccordionItem key={faq.question} value={`item-${faq.question}`}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {/* Money Back Guarantee */}
        <div className="text-center py-12">
          <div className="inline-flex items-center gap-2 bg-secondary/30 px-4 py-2 rounded-full text-sm font-medium">
            <Shield className="w-4 h-4 text-green-500" />
            14-day money-back guarantee on all paid plans
          </div>
        </div>
      </div>
    </Layout>
  );
}
