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
import { isRecord, asString, isAbortedError } from "@/lib/type-guards";

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

type ImageGenerationAttempt = {
  id: string;
  request_id: string;
  status: string;
  error_stage: string | null;
  error_message: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string | null;
};

function toNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
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

function computeRemainingFromCreditsRow(raw: Record<string, unknown>) {
  const monthlyPerCycle = toNumber(raw.monthly_credits_per_cycle, 0);
  const monthlyUsed = toNumber(raw.monthly_credits_used, 0);
  const reservedMonthly = toNumber(raw.reserved_monthly, 0);
  const bonusTotal = toNumber(raw.bonus_credits_total, 0);
  const bonusUsed = toNumber(raw.bonus_credits_used, 0);
  const reservedBonus = toNumber(raw.reserved_bonus, 0);
  return {
    remaining_monthly: Math.max(monthlyPerCycle - monthlyUsed - reservedMonthly, 0),
    remaining_bonus: Math.max(bonusTotal - bonusUsed - reservedBonus, 0),
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

function parseAttempts(raw: unknown): ImageGenerationAttempt[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!isRecord(row)) return null;
      const id = asString(row.id);
      const requestId = asString(row.request_id);
      const status = asString(row.status);
      const createdAt = asString(row.created_at);
      if (!id || !requestId || !status || !createdAt) return null;
      return {
        id,
        request_id: requestId,
        status,
        error_stage: asString(row.error_stage),
        error_message: asString(row.error_message),
        metadata: row.metadata,
        created_at: createdAt,
        updated_at: asString(row.updated_at),
      } satisfies ImageGenerationAttempt;
    })
    .filter(Boolean) as ImageGenerationAttempt[];
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

function getStringFromMetadata(metadata: unknown, key: string) {
  if (!isRecord(metadata)) return null;
  return asString(metadata[key]);
}

function isGenericFailureDescription(value: string) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return true;
  if (s === "generation failed") return true;
  if (s === "credit reservation") return true;
  if (s === "credit reservation released") return true;
  if (s === "credit usage") return true;
  if (s.startsWith("refunded: ")) return false; // Specific refund reasons are NOT generic
  // Don't mark "scene image generation" as generic - it's used as a prefix for specific failure reasons
  return false;
}

function formatFailureStage(stage: string | null) {
  const s = (stage ?? "").trim();
  if (!s) return null;
  const key = s.toLowerCase();
  const known: Record<string, string> = {
    credits_reservation: "Credit Reservation",
    credit_commit: "Credit Commit",
    credit_commit_exception: "Credit Commit",
    credit_consume: "Credit Charge",
    upstream_parse: "Upstream Parse",
    upstream_no_image: "Upstream No Image",
    upstream_error: "Upstream Error",
    blank_image: "Blank Image",
    storage_upload: "Storage Upload",
    scene_update: "Scene Update",
    http_error: "HTTP Error",
    no_image_returned: "No Image Returned",
    client_image_validation: "Client Validation",
    client_exception: "Client Error",
    unexpected_exception: "Unexpected Error",
    client_validation: "Client Validation",
  };
  const hit = known[key];
  if (hit) return hit;
  const words = key.split(/[_-]+/g).filter(Boolean);
  if (words.length === 0) return s;
  return words.map((w) => w.slice(0, 1).toUpperCase() + w.slice(1)).join(" ");
}

function buildRecentActivityRows(transactions: CreditTransaction[]) {
  const isReleaseType = (t: CreditTransaction) => t.transaction_type === "release" || t.transaction_type === "released";
  const isRefundType = (t: CreditTransaction) => t.transaction_type === "refund";
  const isFailureType = (t: CreditTransaction) => t.transaction_type === "failure" || t.transaction_type === "failed";

  const filtered = transactions.filter((tx) => {
    if (!isReleaseType(tx)) return true;
    const releaseType = getStringFromMetadata(tx.metadata, "release_type");
    return releaseType !== "commit";
  });

  const byRequestId = new Map<string, CreditTransaction[]>();
  const withoutRequestId: CreditTransaction[] = [];

  for (const tx of filtered) {
    if (tx.request_id) {
      const list = byRequestId.get(tx.request_id) ?? [];
      list.push(tx);
      byRequestId.set(tx.request_id, list);
    } else {
      withoutRequestId.push(tx);
    }
  }

  const output: CreditTransaction[] = [];

  for (const [requestId, group] of byRequestId.entries()) {
    const hasRefund = group.some(isRefundType);
    const hasRollbackRelease = group.some((t) => isReleaseType(t) && getStringFromMetadata(t.metadata, "release_type") === "rollback");
    const feature = group.map((t) => getFeature(t.metadata)).find(Boolean) ?? null;

    const hasAnyRelease = group.some(isReleaseType);
    const hasFailure = group.some(isFailureType);
    const hasFailureMetadata =
      group.some((t) => Boolean(getStringFromMetadata(t.metadata, "failure_reason"))) ||
      group.some((t) => Boolean(getStringFromMetadata(t.metadata, "release_reason"))) ||
      group.some((t) => Boolean(getStringFromMetadata(t.metadata, "refund_reason"))) ||
      group.some((t) => Boolean(getStringFromMetadata(t.metadata, "error_message")));

    if (hasRefund || hasRollbackRelease || hasAnyRelease || hasFailure || hasFailureMetadata) {
      const refundTx = group.find(isRefundType) ?? null;
      const releaseTx = group.find((t) => isReleaseType(t) && getStringFromMetadata(t.metadata, "release_type") === "rollback") ?? null;
      const anyReleaseTx = group.find(isReleaseType) ?? null;
      const failureTx = group.find(isFailureType) ?? null;
      const chosen = refundTx ?? releaseTx ?? anyReleaseTx ?? failureTx ?? group[0] ?? null;
      if (!chosen) continue;

      const metadataStage =
        group.map((t) => getStringFromMetadata(t.metadata, "stage")).find(Boolean) ??
        group.map((t) => getStringFromMetadata(t.metadata, "error_stage")).find(Boolean) ??
        null;
      const metadataReason =
        group.map((t) => getStringFromMetadata(t.metadata, "failure_reason")).find(Boolean) ??
        group.map((t) => getStringFromMetadata(t.metadata, "release_reason")).find(Boolean) ??
        group.map((t) => getStringFromMetadata(t.metadata, "refund_reason")).find(Boolean) ??
        group.map((t) => getStringFromMetadata(t.metadata, "error_message")).find(Boolean) ??
        null;

      const chosenDescription = typeof chosen.description === "string" ? chosen.description.trim() : "";
      const isGeneric = isGenericFailureDescription(chosenDescription);

      const reason =
        metadataReason ??
        (chosenDescription && !isGeneric ? chosenDescription : null) ??
        group
          .map((t) => (typeof t.description === "string" ? t.description.trim() : ""))
          .find((d) => d && !isGenericFailureDescription(d)) ??
        (chosenDescription ? chosenDescription : null) ??
        null;

      const stageLabel = formatFailureStage(metadataStage);
      const stageAwareReason =
        stageLabel && reason && reason.toLowerCase().includes(stageLabel.toLowerCase()) ? reason : stageLabel ? `${stageLabel}: ${reason ?? "Generation failed"}` : reason;

      output.push({
        id: `failed:${requestId}:${chosen.id}`,
        amount: 0,
        transaction_type: "failed",
        description: stageAwareReason ?? "Generation failed",
        metadata: isRecord(chosen.metadata) ? { ...chosen.metadata, feature } : chosen.metadata,
        pool: chosen.pool,
        created_at: chosen.created_at,
        request_id: chosen.request_id,
      });
      continue;
    }

    for (const tx of group) {
      if (tx.transaction_type === "reservation") continue;
      output.push(tx);
    }
  }

  for (const tx of withoutRequestId) output.push(tx);

  return output.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function buildActivityRows(transactions: CreditTransaction[], attempts: ImageGenerationAttempt[]) {
  const fromCredits = buildRecentActivityRows(transactions);

  const failureFromAttemptsByRequest = new Map<string, CreditTransaction>();
  for (const attempt of attempts) {
    if (attempt.status !== "failed") continue;
    const requestId = attempt.request_id;
    if (!requestId) continue;

    const attemptDescription = (attempt.error_message ?? "").trim();
    const md = isRecord(attempt.metadata) ? attempt.metadata : {};
    const metadata = md.feature ? md : { ...md, feature: "generate-scene-image" };

    const metadataStage = getStringFromMetadata(metadata, "stage") ?? getStringFromMetadata(metadata, "error_stage");
    const metadataReason =
      getStringFromMetadata(metadata, "failure_reason") ??
      getStringFromMetadata(metadata, "error_message") ??
      getStringFromMetadata(metadata, "refund_reason") ??
      getStringFromMetadata(metadata, "release_reason");
    const baseDescription = attemptDescription || (metadataReason ?? "").trim() || "Generation failed";

    const inferredStage =
      (attempt.error_stage ?? metadataStage) ||
      (baseDescription.toLowerCase().includes("blank image generation") ? "blank_image" : null);
    const stageLabel = formatFailureStage(inferredStage);
    const description =
      stageLabel && baseDescription.toLowerCase().includes(stageLabel.toLowerCase())
        ? baseDescription
        : stageLabel
          ? `${stageLabel}: ${baseDescription || "Generation failed"}`
          : baseDescription || "Generation failed";

    const createdAt = attempt.updated_at ?? attempt.created_at;
    failureFromAttemptsByRequest.set(requestId, {
      id: `attempt:${attempt.id}`,
      amount: 0,
      transaction_type: "failed",
      description,
      metadata,
      pool: null,
      created_at: createdAt,
      request_id: requestId,
    });
  }

  const requestIdsInCredits = new Set<string>();
  for (const row of fromCredits) {
    if (row.request_id) requestIdsInCredits.add(row.request_id);
  }

  const usedFailure = new Set<string>();
  const output: CreditTransaction[] = [];
  for (const row of fromCredits) {
    const requestId = row.request_id;
    if (!requestId) {
      output.push(row);
      continue;
    }

    const failureRow = failureFromAttemptsByRequest.get(requestId) ?? null;
    if (failureRow) {
      if (usedFailure.has(requestId)) continue;
      usedFailure.add(requestId);
      output.push(failureRow);
      continue;
    }

    output.push(row);
  }

  for (const [requestId, failureRow] of failureFromAttemptsByRequest.entries()) {
    if (requestIdsInCredits.has(requestId)) continue;
    output.push(failureRow);
  }

  output.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return output;
}

export default function Profile() {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [credits, setCredits] = useState<CreditsStatus | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [attempts, setAttempts] = useState<ImageGenerationAttempt[]>([]);

  const activityRows = useMemo(() => buildActivityRows(transactions, attempts), [attempts, transactions]);

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
      const accessToken = sessionData.session?.access_token ?? null;
      const { data, error } = await supabase.functions.invoke("credits", {
        body: { action: "status", limit: 50 },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      const directFetch = async () => {
        type QueryResponse = { data: unknown; error: unknown };
        type PostgrestLike = {
          select: (columns: string) => PostgrestLike;
          eq: (column: string, value: string) => PostgrestLike;
          order: (column: string, opts: { ascending: boolean }) => PostgrestLike;
          limit: (count: number) => PostgrestLike;
          maybeSingle: () => Promise<QueryResponse>;
          then?: never;
        };
        type SupabaseFromLike = { from: (table: string) => PostgrestLike };

        const db = supabase as unknown as SupabaseFromLike;

        const { data: creditsRow, error: creditsErr } = await db.from("user_credits").select("*").eq("user_id", user.id).maybeSingle();
        const txQuery = db.from("credit_transactions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50) as unknown as Promise<QueryResponse>;
        const { data: txRows, error: txErr } = await txQuery;

        if (creditsErr || txErr) return { ok: false as const, creditsErr, txErr };

        const creditsRec = isRecord(creditsRow) ? creditsRow : null;
        const computedRemaining = creditsRec ? computeRemainingFromCreditsRow(creditsRec) : null;
        const mergedCredits =
          creditsRec && computedRemaining
            ? { ...creditsRec, ...computedRemaining }
            : creditsRec;

        return {
          ok: true as const,
          credits: mergedCredits ? parseCreditsStatus(mergedCredits) : null,
          transactions: parseTransactions(txRows),
        };
      };

      if (error) {
        if (isAbortedError(error)) return;
        const fallback = await directFetch();
        if (fallback.ok) {
          setCredits(fallback.credits);
          setTransactions(fallback.transactions);
          const { data: attemptRows } = await supabase
            .from("image_generation_attempts")
            .select("id,request_id,status,error_stage,error_message,metadata,created_at,updated_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(50);
          setAttempts(parseAttempts(attemptRows));
          return;
        }
        if (isAbortedError((fallback as unknown as { creditsErr?: unknown }).creditsErr) || isAbortedError((fallback as unknown as { txErr?: unknown }).txErr)) return;
        const e = error as unknown as { message?: string; name?: string; context?: unknown };
        const message = typeof e?.message === "string" ? e.message : String(error);
        const name = typeof e?.name === "string" ? e.name : "Function error";
        toast({ title: "Failed to load credits", description: `${name}: ${message}`, variant: "destructive" });
        return;
      }

      if (isRecord(data) && data.success === true) {
        const parsedCredits = parseCreditsStatus(data.credits);
        setCredits(parsedCredits);
        setTransactions(parseTransactions(data.transactions));
        if (isRecord(data) && "attempts" in data) setAttempts(parseAttempts((data as Record<string, unknown>).attempts));
        else {
          const { data: attemptRows } = await supabase
            .from("image_generation_attempts")
            .select("id,request_id,status,error_stage,error_message,metadata,created_at,updated_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(50);
          setAttempts(parseAttempts(attemptRows));
        }
        return;
      }

      const fallback = await directFetch();
      if (fallback.ok) {
        setCredits(fallback.credits);
        setTransactions(fallback.transactions);
        const { data: attemptRows } = await supabase
          .from("image_generation_attempts")
          .select("id,request_id,status,error_stage,error_message,metadata,created_at,updated_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50);
        setAttempts(parseAttempts(attemptRows));
        return;
      }

      if (isRecord(data) && typeof data.error === "string") {
        toast({ title: "Failed to load credits", description: data.details ? `${data.error}: ${String(data.details)}` : data.error, variant: "destructive" });
        return;
      }
    } catch (e) {
      if (isAbortedError(e)) return;
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
                  {activityRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        {loading ? "Loading…" : "No credit activity yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    activityRows.map((tx) => {
                      const feature = getFeature(tx.metadata);
                      const amountLabel = tx.amount > 0 ? `+${tx.amount}` : String(tx.amount);
                      const amountVariant = tx.amount < 0 ? "destructive" : "secondary";
                      const fallbackDescription = (() => {
                        if (!isRecord(tx.metadata)) return null;
                        const md = tx.metadata;
                        return (
                          asString(md.failure_reason) ??
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
