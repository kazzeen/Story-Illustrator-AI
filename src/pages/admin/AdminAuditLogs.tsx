import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdmin } from "@/hooks/useAdmin";
import { useToast } from "@/hooks/use-toast";

type AuditRow = {
  id: string;
  admin_username: string;
  action_type: string;
  target_user_id: string | null;
  reason: string | null;
  created_at: string;
};

type AuditResponse = {
  ok: boolean;
  page: number;
  pageSize: number;
  total: number;
  rows: AuditRow[];
};

export default function AdminAuditLogs() {
  const { session } = useAdmin();
  const { toast } = useToast();
  const csrf = session?.csrfToken ?? "";
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AuditResponse | null>(null);

  const url = useMemo(() => `/api/admin/audit-logs?page=${page}&pageSize=${pageSize}`, [page, pageSize]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resp = await fetch(url, { credentials: "include", headers: { "x-csrf-token": csrf } });
        const json = (await resp.json()) as AuditResponse;
        if (!resp.ok) throw new Error((json as unknown as { error?: string }).error ?? `HTTP_${resp.status}`);
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setData(null);
        const msg = e instanceof Error ? e.message : "Failed to load audit logs";
        toast({ title: "Failed to load audit logs", description: msg, variant: "destructive" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, csrf, toast]);

  return (
    <Layout>
      <div className="container mx-auto px-6 py-10 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Audit Logs</h1>
          <Button asChild variant="outline">
            <Link to="/admin">Back</Link>
          </Button>
        </div>

        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={5}>Loading…</TableCell>
                </TableRow>
              )}
              {!loading && (!data?.rows?.length ? true : false) && (
                <TableRow>
                  <TableCell colSpan={5}>No audit logs.</TableCell>
                </TableRow>
              )}
              {(data?.rows ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.created_at}</TableCell>
                  <TableCell>{row.admin_username}</TableCell>
                  <TableCell>{row.action_type}</TableCell>
                  <TableCell className="font-mono text-xs">{row.target_user_id ?? "-"}</TableCell>
                  <TableCell>{row.reason ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <div className="text-sm text-muted-foreground">
            Page {data?.page ?? page} of {data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : "…"}
          </div>
          <Button
            variant="outline"
            disabled={!data || data.page * data.pageSize >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </Layout>
  );
}

