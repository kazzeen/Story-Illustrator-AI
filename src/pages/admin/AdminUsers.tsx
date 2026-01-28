import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdmin } from "@/hooks/useAdmin";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AdminUserRow = {
  user_id: string;
  email: string | null;
  created_at: string | null;
  last_login_at: string | null;
  plan_tier: string | null;
  credits_balance: number | null;
  stories_count: number | null;
  scenes_count: number | null;
};

type UsersResponse = {
  ok: boolean;
  page: number;
  pageSize: number;
  total: number;
  rows: AdminUserRow[];
};

export default function AdminUsers() {
  const { session } = useAdmin();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [planTier, setPlanTier] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [activity, setActivity] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<UsersResponse | null>(null);

  const csrf = session?.csrfToken ?? "";

  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (query.trim()) params.set("q", query.trim());
    if (planTier !== "all") params.set("planTier", planTier);
    if (status !== "all") params.set("status", status);
    if (activity !== "all") params.set("activity", activity);
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);
    return `/api/admin/users?${params.toString()}`;
  }, [page, pageSize, query, planTier, status, activity, sortBy, sortDir]);

  const toggleSort = (nextSortBy: string) => {
    setPage(1);
    setSortBy((prev) => {
      if (prev !== nextSortBy) {
        setSortDir("asc");
        return nextSortBy;
      }
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return prev;
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resp = await fetch(url, { credentials: "include", headers: { "x-csrf-token": csrf } });
        const json = (await resp.json()) as UsersResponse;
        if (!resp.ok) throw new Error((json as unknown as { error?: string }).error ?? `HTTP_${resp.status}`);
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setData(null);
        const msg = e instanceof Error ? e.message : "Failed to load users";
        toast({ title: "Failed to load users", description: msg, variant: "destructive" });
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
          <h1 className="text-2xl font-semibold">Users</h1>
          <Button asChild variant="outline">
            <Link to="/admin">Back</Link>
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Input
            placeholder="Search by email or user id…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <Select
            value={planTier}
            onValueChange={(v) => {
              setPlanTier(v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Plan tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plans</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="starter">Starter</SelectItem>
              <SelectItem value="creator">Creator</SelectItem>
              <SelectItem value="professional">Professional</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={activity}
            onValueChange={(v) => {
              setActivity(v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Activity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All activity</SelectItem>
              <SelectItem value="active">Active (30d)</SelectItem>
              <SelectItem value="inactive">Inactive (30d)</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setQuery("");
                setPlanTier("all");
                setStatus("all");
                setActivity("all");
                setSortBy("created_at");
                setSortDir("desc");
                setPage(1);
              }}
            >
              Reset
            </Button>
          </div>
        </div>

        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button type="button" className="underline-offset-4 hover:underline" onClick={() => toggleSort("email")}>
                    Email
                  </button>
                </TableHead>
                <TableHead>
                  <button type="button" className="underline-offset-4 hover:underline" onClick={() => toggleSort("created_at")}>
                    Created
                  </button>
                </TableHead>
                <TableHead>
                  <button type="button" className="underline-offset-4 hover:underline" onClick={() => toggleSort("last_login_at")}>
                    Last login
                  </button>
                </TableHead>
                <TableHead>
                  <button type="button" className="underline-offset-4 hover:underline" onClick={() => toggleSort("plan_tier")}>
                    Plan
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" className="underline-offset-4 hover:underline" onClick={() => toggleSort("credits_balance")}>
                    Credits
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" className="underline-offset-4 hover:underline" onClick={() => toggleSort("stories_count")}>
                    Stories
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" className="underline-offset-4 hover:underline" onClick={() => toggleSort("scenes_count")}>
                    Scenes
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={7}>Loading…</TableCell>
                </TableRow>
              )}
              {!loading && (!data?.rows?.length ? true : false) && (
                <TableRow>
                  <TableCell colSpan={7}>No users found.</TableCell>
                </TableRow>
              )}
              {(data?.rows ?? []).map((row) => (
                <TableRow key={row.user_id}>
                  <TableCell>
                    <Link className="text-primary underline" to={`/admin/users/${row.user_id}`}>
                      {row.email ?? row.user_id}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{row.created_at ?? "-"}</TableCell>
                  <TableCell className="text-xs">{row.last_login_at ?? "-"}</TableCell>
                  <TableCell>{row.plan_tier ?? "-"}</TableCell>
                  <TableCell className="text-right">{row.credits_balance ?? 0}</TableCell>
                  <TableCell className="text-right">{row.stories_count ?? 0}</TableCell>
                  <TableCell className="text-right">{row.scenes_count ?? 0}</TableCell>
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
