
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { adminApi } from "@/hooks/admin-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Save, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function AdminUserDetails() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [credits, setCredits] = useState<number>(0);
  const [tier, setTier] = useState<string>("free");

  useEffect(() => {
    if (userId) {
      loadUser();
    }
  }, [userId]);

  const loadUser = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await adminApi<{ user: any }>(`users/${userId}`);
      const user = response.user;
      
      setData(user);
      setCredits(user.profile?.credits_balance || 0);
      setTier(user.profile?.subscription_tier || "free");
    } catch (err: any) {
      console.error("Failed to load user details", err);
      setError(err.message || "Failed to load user details");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await adminApi(`users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          credits_balance: credits,
          subscription_tier: tier
        })
      });
      toast.success("User profile updated successfully");
      loadUser(); // Refresh data
    } catch (err: any) {
      console.error("Failed to update user", err);
      toast.error(err.message || "Failed to update user");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto px-6 pt-24 flex justify-center">
          <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto px-6 pt-24">
          <div className="bg-destructive/15 text-destructive p-4 rounded-md mb-4">
            {error || "User not found"}
          </div>
          <Button variant="outline" onClick={() => navigate("/admin/users")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Users
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-6 pt-24 pb-12">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate("/admin/users")}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <h1 className="text-2xl font-bold">User Details</h1>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Main Info */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Email</Label>
                  <div className="text-sm font-medium mt-1">{data.email}</div>
                </div>
                <div>
                  <Label>User ID</Label>
                  <div className="text-xs font-mono text-muted-foreground mt-1">{data.id}</div>
                </div>
                <div>
                  <Label>Joined</Label>
                  <div className="text-sm text-muted-foreground mt-1">
                    {new Date(data.created_at).toLocaleDateString()} {new Date(data.created_at).toLocaleTimeString()}
                  </div>
                </div>
                <div>
                  <Label>Last Sign In</Label>
                  <div className="text-sm text-muted-foreground mt-1">
                    {data.last_sign_in_at ? new Date(data.last_sign_in_at).toLocaleDateString() : "Never"}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="credits">Credits Balance</Label>
                    <Input
                      id="credits"
                      type="number"
                      value={credits}
                      onChange={(e) => setCredits(parseInt(e.target.value) || 0)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Manually adjust available credits.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tier">Subscription Tier</Label>
                    <Select value={tier} onValueChange={setTier}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select tier" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="free">Free</SelectItem>
                        <SelectItem value="starter">Starter</SelectItem>
                        <SelectItem value="creator">Creator</SelectItem>
                        <SelectItem value="professional">Professional</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats / Side Panel */}
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Role</span>
                <Badge variant={data.profile?.is_admin ? "default" : "secondary"}>
                  {data.profile?.is_admin ? "Admin" : "User"}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Confirmed</span>
                <Badge variant={data.email_confirmed_at ? "outline" : "destructive"}>
                  {data.email_confirmed_at ? "Yes" : "No"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Activity Log */}
          <Card className="md:col-span-3">
            <CardHeader>
              <CardTitle>Credit Activity Log</CardTitle>
              <CardDescription>Recent credit usage and purchases.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Feature</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.transactions?.length > 0 ? (
                    data.transactions.map((tx: any) => (
                      <TableRow key={tx.id}>
                        <TableCell>
                          {new Date(tx.created_at).toLocaleDateString()} {new Date(tx.created_at).toLocaleTimeString()}
                        </TableCell>
                        <TableCell className="capitalize">{tx.transaction_type}</TableCell>
                        <TableCell className="capitalize">{tx.feature_type || "-"}</TableCell>
                        <TableCell className={`text-right font-mono ${tx.amount > 0 ? "text-green-500" : "text-red-500"}`}>
                          {tx.amount > 0 ? "+" : ""}{tx.amount}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-4">
                        No activity found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
