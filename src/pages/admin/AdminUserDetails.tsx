import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAdmin } from "@/hooks/useAdmin";

type CreditTxn = {
  id: string;
  amount: number;
  transaction_type: string;
  description: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

type UserDetailsResponse = {
  ok: boolean;
  user: {
    user_id: string;
    email: string | null;
    created_at: string | null;
    last_login_at: string | null;
    plan_tier: string | null;
    plan_status: string | null;
    plan_expires_at: string | null;
    last_activity_at: string | null;
    credits_balance: number | null;
    stories_count: number | null;
    scenes_count: number | null;
  };
  credit_history: CreditTxn[];
  plan_history?: Array<{
    id: string;
    admin_username: string;
    old_tier: string | null;
    new_tier: string | null;
    old_status: string | null;
    new_status: string | null;
    old_expires_at: string | null;
    new_expires_at: string | null;
    notes: string | null;
    created_at: string;
  }>;
};

export default function AdminUserDetails() {
  const { id } = useParams();
  const { session } = useAdmin();
  const csrf = session?.csrfToken ?? "";
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<UserDetailsResponse | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditOp, setCreditOp] = useState<"add" | "deduct" | "set">("add");
  const [creditReason, setCreditReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [planSubmitting, setPlanSubmitting] = useState(false);
  const [planConfirmOpen, setPlanConfirmOpen] = useState(false);
  const [newTier, setNewTier] = useState<string>("nochange");
  const [newStatus, setNewStatus] = useState<string>("nochange");
  const [newExpiresLocal, setNewExpiresLocal] = useState<string>("");
  const [planNotes, setPlanNotes] = useState<string>("");

  const url = useMemo(() => (id ? `/api/admin/users/${encodeURIComponent(id)}` : null), [id]);

  const refresh = async () => {
    if (!url) return;
    setLoading(true);
    try {
      const resp = await fetch(url, { credentials: "include", headers: { "x-csrf-token": csrf } });
      const json = (await resp.json()) as UserDetailsResponse;
      if (!resp.ok) throw new Error((json as unknown as { error?: string }).error ?? `HTTP_${resp.status}`);
      setData(json);
    } catch (e) {
      setData(null);
      const msg = e instanceof Error ? e.message : "Failed to load user";
      toast({ title: "Failed to load user", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [url]);

  const submitCredits = async () => {
    if (!id) return;
    const amt = Number(creditAmount);
    if (!Number.isFinite(amt) || Math.trunc(amt) !== amt) {
      toast({ title: "Invalid amount", description: "Enter an integer credit amount.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch(`/api/admin/users/${encodeURIComponent(id)}/credits`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ operation: creditOp, amount: amt, reason: creditReason || null }),
      });
      const json = (await resp.json()) as { ok?: boolean; error?: string };
      if (!resp.ok) throw new Error(json.error ?? `HTTP_${resp.status}`);
      toast({ title: "Credits updated", description: "The user’s credits were modified." });
      setCreditReason("");
      setCreditAmount("");
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Credit update failed";
      toast({ title: "Credit update failed", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const requestSubmitCredits = () => {
    if (creditOp === "deduct" || creditOp === "set") {
      setConfirmOpen(true);
      return;
    }
    void submitCredits();
  };

  const submitPlan = async () => {
    if (!id) return;
    setPlanSubmitting(true);
    try {
      const newExpiresAt = newExpiresLocal ? new Date(newExpiresLocal).toISOString() : null;
      const resp = await fetch(`/api/admin/users/${encodeURIComponent(id)}/plan`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({
          newTier: newTier === "nochange" ? null : newTier,
          newStatus: newStatus === "nochange" ? null : newStatus,
          newExpiresAt,
          notes: planNotes || null,
        }),
      });
      const json = (await resp.json()) as { ok?: boolean; error?: string };
      if (!resp.ok) throw new Error(json.error ?? `HTTP_${resp.status}`);
      toast({ title: "Plan updated", description: "The user’s plan was updated." });
      setPlanNotes("");
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Plan update failed";
      toast({ title: "Plan update failed", description: msg, variant: "destructive" });
    } finally {
      setPlanSubmitting(false);
    }
  };

  const requestSubmitPlan = () => {
    if (newStatus === "suspended" || (newTier !== "nochange" && newTier !== (data?.user.plan_tier ?? ""))) {
      setPlanConfirmOpen(true);
      return;
    }
    void submitPlan();
  };

  return (
    <Layout>
      <div className="container mx-auto px-6 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">User Details</h1>
          <Button asChild variant="outline">
            <Link to="/admin/users">Back to Users</Link>
          </Button>
        </div>

        {loading && <div>Loading…</div>}
        {!loading && !data && <div>User not found.</div>}

        {data && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Account</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 md:grid-cols-2 text-sm">
                <div>
                  <div className="text-muted-foreground">Email</div>
                  <div className="font-medium">{data.user.email ?? "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">User ID</div>
                  <div className="font-mono text-xs break-all">{data.user.user_id}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Created</div>
                  <div className="font-medium">{data.user.created_at ?? "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Last login</div>
                  <div className="font-medium">{data.user.last_login_at ?? "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Plan</div>
                  <div className="font-medium">{data.user.plan_tier ?? "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Plan status</div>
                  <div className="font-medium">{data.user.plan_status ?? "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Plan expires</div>
                  <div className="font-medium">{data.user.plan_expires_at ?? "-"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Credits</div>
                  <div className="font-medium">{data.user.credits_balance ?? 0}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Stories</div>
                  <div className="font-medium">{data.user.stories_count ?? 0}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Scenes</div>
                  <div className="font-medium">{data.user.scenes_count ?? 0}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Last activity</div>
                  <div className="font-medium">{data.user.last_activity_at ?? "-"}</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Credits</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 md:grid-cols-4">
                  <div className="md:col-span-1">
                    <label className="text-sm font-medium">Operation</label>
                    <div className="flex gap-2 mt-2">
                      <Button type="button" variant={creditOp === "add" ? "default" : "outline"} onClick={() => setCreditOp("add")}>
                        Add
                      </Button>
                      <Button type="button" variant={creditOp === "deduct" ? "default" : "outline"} onClick={() => setCreditOp("deduct")}>
                        Deduct
                      </Button>
                      <Button type="button" variant={creditOp === "set" ? "default" : "outline"} onClick={() => setCreditOp("set")}>
                        Set
                      </Button>
                    </div>
                  </div>
                  <div className="md:col-span-1">
                    <label className="text-sm font-medium">Amount</label>
                    <Input className="mt-2" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="e.g. 50" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium">Reason (optional)</label>
                    <Input
                      className="mt-2"
                      value={creditReason}
                      onChange={(e) => setCreditReason(e.target.value)}
                      placeholder="e.g. manual adjustment"
                    />
                  </div>
                </div>
                <Button disabled={submitting} onClick={requestSubmitCredits}>
                  {submitting ? "Applying…" : "Apply Credit Change"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Plan Management</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 md:grid-cols-4">
                  <div>
                    <label className="text-sm font-medium">Tier</label>
                    <Select value={newTier} onValueChange={setNewTier}>
                      <SelectTrigger className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nochange">No change</SelectItem>
                        <SelectItem value="free">Free</SelectItem>
                        <SelectItem value="starter">Starter</SelectItem>
                        <SelectItem value="creator">Creator</SelectItem>
                        <SelectItem value="professional">Professional</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Status</label>
                    <Select value={newStatus} onValueChange={setNewStatus}>
                      <SelectTrigger className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nochange">No change</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Expires at</label>
                    <Input
                      className="mt-2"
                      type="datetime-local"
                      value={newExpiresLocal}
                      onChange={(e) => setNewExpiresLocal(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Admin note</label>
                    <Input className="mt-2" value={planNotes} onChange={(e) => setPlanNotes(e.target.value)} placeholder="Optional" />
                  </div>
                </div>
                <Button disabled={planSubmitting} onClick={requestSubmitPlan}>
                  {planSubmitting ? "Applying…" : "Apply Plan Change"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Plan History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Admin</TableHead>
                        <TableHead>Tier</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead>Note</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data.plan_history ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6}>No plan changes.</TableCell>
                        </TableRow>
                      )}
                      {(data.plan_history ?? []).map((h) => (
                        <TableRow key={h.id}>
                          <TableCell>{h.created_at}</TableCell>
                          <TableCell>{h.admin_username}</TableCell>
                          <TableCell>
                            {(h.old_tier ?? "-") + " → " + (h.new_tier ?? "-")}
                          </TableCell>
                          <TableCell>
                            {(h.old_status ?? "-") + " → " + (h.new_status ?? "-")}
                          </TableCell>
                          <TableCell>{h.new_expires_at ?? "-"}</TableCell>
                          <TableCell>{h.notes ?? "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Credit History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Admin</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data.credit_history ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5}>No credit transactions.</TableCell>
                        </TableRow>
                      )}
                      {(data.credit_history ?? []).map((t) => (
                        <TableRow key={t.id}>
                          <TableCell>{t.created_at}</TableCell>
                          <TableCell>
                            {t.metadata && typeof t.metadata === "object" && typeof t.metadata.admin_username === "string"
                              ? t.metadata.admin_username
                              : "-"}
                          </TableCell>
                          <TableCell>{t.transaction_type}</TableCell>
                          <TableCell className="text-right">{t.amount}</TableCell>
                          <TableCell>{t.description ?? "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm credit change</AlertDialogTitle>
            <AlertDialogDescription>
              This action may reduce or override a user’s available credits. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(e) => {
                e.preventDefault();
                setConfirmOpen(false);
                void submitCredits();
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={planConfirmOpen} onOpenChange={setPlanConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm plan change</AlertDialogTitle>
            <AlertDialogDescription>
              This action may suspend the account or alter subscription benefits. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={planSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={planSubmitting}
              onClick={(e) => {
                e.preventDefault();
                setPlanConfirmOpen(false);
                void submitPlan();
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
