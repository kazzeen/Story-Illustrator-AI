import { useCallback, useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

type CreditsStatus = {
  tier: string | null;
  monthly_credits_per_cycle: number;
  monthly_credits_used: number;
  bonus_credits_total: number;
  bonus_credits_used: number;
  remaining_monthly: number;
  remaining_bonus: number;
  cycle_start_at: string | null;
  cycle_end_at: string | null;
};

type CreditTransaction = {
  id: string;
  amount: number;
  transaction_type: string;
  description: string | null;
  metadata: unknown;
  pool: string | null;
  created_at: string;
  request_id: string | null;
};

function toNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCreditsStatus(raw: unknown): CreditsStatus | null {
  if (!isRecord(raw)) return null;
  const tierRaw = asString(raw.tier);
  return {
    tier: tierRaw ? tierRaw : null,
    monthly_credits_per_cycle: toNumber(raw.monthly_credits_per_cycle, 0),
    monthly_credits_used: toNumber(raw.monthly_credits_used, 0),
    bonus_credits_total: toNumber(raw.bonus_credits_total, 0),
    bonus_credits_used: toNumber(raw.bonus_credits_used, 0),
    remaining_monthly: toNumber(raw.remaining_monthly, 0),
    remaining_bonus: toNumber(raw.remaining_bonus, 0),
    cycle_start_at: asString(raw.cycle_start_at),
    cycle_end_at: asString(raw.cycle_end_at),
  };
}

function parseTransactions(raw: unknown): CreditTransaction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!isRecord(row)) return null;
      const id = asString(row.id);
      const createdAt = asString(row.created_at);
      if (!id || !createdAt) return null;
      return {
        id,
        amount: toNumber(row.amount, 0),
        transaction_type: asString(row.transaction_type) ?? "",
        description: asString(row.description),
        metadata: row.metadata,
        pool: asString(row.pool),
        created_at: createdAt,
        request_id: asString(row.request_id),
      } satisfies CreditTransaction;
    })
    .filter(Boolean) as CreditTransaction[];
}

function formatPlanLabel(tier: string | null) {
  const t = (tier ?? "").trim().toLowerCase();
  if (t === "starter") return "Starter";
  if (t === "creator") return "Creator";
  if (t === "professional") return "Pro";
  if (t === "basic") return "Free";
  if (!t) return "Free";
  return t.slice(0, 1).toUpperCase() + t.slice(1);
}

function getFeature(metadata: unknown) {
  if (!isRecord(metadata)) return null;
  const feature = asString(metadata.feature);
  return feature ? feature : null;
}

export default function Profile() {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [credits, setCredits] = useState<CreditsStatus | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);

  const planLabel = useMemo(() => formatPlanLabel(profile?.subscription_tier ?? credits?.tier ?? null), [credits?.tier, profile?.subscription_tier]);
  const creditsBalance = typeof profile?.credits_balance === "number" ? profile.credits_balance : null;
  const computedBalance = useMemo(() => {
    const remainingMonthly = credits?.remaining_monthly;
    const remainingBonus = credits?.remaining_bonus;
    if (typeof remainingMonthly === "number" && typeof remainingBonus === "number") return Math.max(remainingMonthly + remainingBonus, 0);
    return creditsBalance ?? 0;
  }, [credits?.remaining_bonus, credits?.remaining_monthly, creditsBalance]);

  const fetchCredits = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? null;
      if (!token) return;

      const { data, error } = await supabase.functions.invoke("credits", {
        body: { action: "status", limit: 50 },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) {
        toast({ title: "Failed to load credits", description: String(error.message || error), variant: "destructive" });
        return;
      }
      if (!isRecord(data)) return;
      const parsedCredits = parseCreditsStatus(data.credits);
      setCredits(parsedCredits);
      setTransactions(parseTransactions(data.transactions));
    } catch (e) {
      toast({ title: "Failed to load credits", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    void fetchCredits();
  }, [fetchCredits, user?.id]);

  useEffect(() => {
    if (!user) return;

    type RealtimeChannelLike = {
      on: (event: string, filter: Record<string, unknown>, cb: (payload: unknown) => void) => RealtimeChannelLike;
      subscribe: () => RealtimeChannelLike;
    };

    const maybeSupabase = supabase as unknown as {
      channel?: (name: string) => {
        on: (event: string, filter: Record<string, unknown>, cb: (payload: unknown) => void) => RealtimeChannelLike;
        subscribe: () => RealtimeChannelLike;
      };
      removeChannel?: (channel: RealtimeChannelLike) => Promise<unknown>;
    };

    if (typeof maybeSupabase.channel !== "function" || typeof maybeSupabase.removeChannel !== "function") return;

    let timer: number | null = null;
    const scheduleRefresh = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void fetchCredits(), 150);
    };

    const channel = maybeSupabase
      .channel(`credits-ui:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_credits", filter: `user_id=eq.${user.id}` },
        () => scheduleRefresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "credit_transactions", filter: `user_id=eq.${user.id}` },
        () => scheduleRefresh(),
      )
      .subscribe();

    const onFocus = () => {
      void Promise.all([fetchCredits(), refreshProfile()]);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void Promise.all([fetchCredits(), refreshProfile()]);
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      void maybeSupabase.removeChannel?.(channel);
    };
  }, [fetchCredits, refreshProfile, user?.id]);

  if (!user) {
    return (
      <Layout>
        <div className="container mx-auto px-6 py-10">
          <Card className="max-w-xl mx-auto">
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-muted-foreground">Sign in to view your account and credit usage.</div>
              <Button asChild>
                <Link to="/auth">Sign In</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  const monthlyPerCycle = credits?.monthly_credits_per_cycle ?? 0;
  const monthlyUsed = credits?.monthly_credits_used ?? 0;
  const bonusTotal = credits?.bonus_credits_total ?? 0;
  const bonusUsed = credits?.bonus_credits_used ?? 0;
  const monthlyPct = monthlyPerCycle > 0 ? Math.round((Math.min(monthlyUsed, monthlyPerCycle) / monthlyPerCycle) * 100) : 0;
  const bonusPct = bonusTotal > 0 ? Math.round((Math.min(bonusUsed, bonusTotal) / bonusTotal) * 100) : 0;

  return (
    <Layout>
      <div className="container mx-auto px-6 py-10 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Profile</h1>
            <div className="text-sm text-muted-foreground">{user.email}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{planLabel}</Badge>
            <Button variant="outline" onClick={() => void Promise.all([refreshProfile(), fetchCredits()])} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">Display name</div>
                <div className="text-sm font-medium">{profile?.display_name || "—"}</div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">Plan</div>
                <div className="text-sm font-medium">{planLabel}</div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">Credits</div>
                <div className="text-sm font-medium" data-testid="profile-account-credits-balance">
                  {computedBalance}
                </div>
              </div>
              <div className="pt-2">
                <Button asChild variant="secondary" className="w-full">
                  <Link to="/pricing">Manage plan / buy credits</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Credits</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-lg border p-4">
                  <div className="text-xs text-muted-foreground">Balance</div>
                  <div className="mt-1 text-2xl font-semibold" data-testid="profile-credits-balance">
                    {computedBalance}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">credits</div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-xs text-muted-foreground">Remaining (monthly)</div>
                  <div className="mt-1 text-2xl font-semibold">{credits?.remaining_monthly ?? 0}</div>
                  <div className="mt-1 text-xs text-muted-foreground">of {monthlyPerCycle}</div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-xs text-muted-foreground">Remaining (bonus)</div>
                  <div className="mt-1 text-2xl font-semibold">{credits?.remaining_bonus ?? 0}</div>
                  <div className="mt-1 text-xs text-muted-foreground">of {bonusTotal}</div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="text-muted-foreground">Monthly usage</div>
                    <div className="font-medium">{monthlyUsed} / {monthlyPerCycle}</div>
                  </div>
                  <Progress value={monthlyPct} />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="text-muted-foreground">Bonus usage</div>
                    <div className="font-medium">{bonusUsed} / {bonusTotal}</div>
                  </div>
                  <Progress value={bonusPct} />
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <div className="text-muted-foreground">Cycle ends</div>
                <div className="font-medium">{credits?.cycle_end_at ? new Date(credits.cycle_end_at).toLocaleString() : "—"}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Feature</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        {loading ? "Loading…" : "No credit activity yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    transactions.map((tx) => {
                      const feature = getFeature(tx.metadata);
                      const amountLabel = tx.amount > 0 ? `+${tx.amount}` : String(tx.amount);
                      const amountVariant = tx.amount < 0 ? "destructive" : "secondary";
                      const fallbackDescription = (() => {
                        if (!isRecord(tx.metadata)) return null;
                        const md = tx.metadata;
                        return (
                          asString(md.release_reason) ??
                          asString(md.refund_reason) ??
                          asString(md.error_message) ??
                          asString(md.error) ??
                          null
                        );
                      })();
                      return (
                        <TableRow key={tx.id}>
                          <TableCell className="whitespace-nowrap">{new Date(tx.created_at).toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge variant={amountVariant}>{amountLabel}</Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{tx.transaction_type}</TableCell>
                          <TableCell className="whitespace-nowrap">{feature ?? "—"}</TableCell>
                          <TableCell className="min-w-[16rem]">{tx.description ?? fallbackDescription ?? "—"}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
