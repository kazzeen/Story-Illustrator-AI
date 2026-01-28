
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
import { ArrowLeft, Save, RefreshCw, User, CreditCard, History, Shield, Mail } from "lucide-react";
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
      toast.error("Failed to fetch user details");
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
        <div className="container mx-auto px-6 pt-24 flex flex-col items-center justify-center">
          <RefreshCw className="w-8 h-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto px-6 pt-24">
          <div className="bg-destructive/15 text-destructive p-4 rounded-xl mb-4 flex items-center gap-3 border border-destructive/20">
             <Shield className="w-5 h-5" />
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
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin/users")} className="rounded-full">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-display font-bold text-foreground">User Details</h1>
              <p className="text-muted-foreground text-sm">Manage profile and credits for {data.email}</p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-lg hover:shadow-primary/25 transition-all">
            {saving ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {/* Main Info */}
          <Card className="md:col-span-2 border-border/50 shadow-md">
            <CardHeader className="border-b border-border/50 bg-secondary/20">
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5 text-primary" />
                Profile Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5" /> Email Address
                  </Label>
                  <div className="font-medium text-lg">{data.email}</div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">User ID</Label>
                  <div className="text-xs font-mono bg-secondary/50 p-2 rounded border">{data.id}</div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Joined Date</Label>
                  <div className="font-medium">
                    {new Date(data.created_at).toLocaleDateString()}
                    <span className="text-muted-foreground text-sm ml-2">
                      {new Date(data.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Last Sign In</Label>
                  <div className="font-medium">
                    {data.last_sign_in_at ? new Date(data.last_sign_in_at).toLocaleDateString() : "Never"}
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-border/50">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-primary" />
                  Subscription & Credits
                </h3>
                <div className="grid grid-cols-2 gap-6 p-4 bg-secondary/10 rounded-xl border border-border/50">
                  <div className="space-y-3">
                    <Label htmlFor="credits" className="text-base">Credits Balance</Label>
                    <div className="flex items-center gap-3">
                      <Input
                        id="credits"
                        type="number"
                        value={credits}
                        onChange={(e) => setCredits(parseInt(e.target.value) || 0)}
                        className="text-lg font-mono"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Current available credits.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <Label htmlFor="tier" className="text-base">Subscription Tier</Label>
                    <Select value={tier} onValueChange={setTier}>
                      <SelectTrigger className="h-10">
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
          <div className="space-y-6">
            <Card className="border-border/50 shadow-md">
              <CardHeader className="border-b border-border/50 bg-secondary/20">
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-primary" />
                  Account Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                <div className="flex justify-between items-center p-3 rounded-lg bg-secondary/30">
                  <span className="text-sm font-medium">Role</span>
                  <Badge variant={data.profile?.is_admin ? "default" : "secondary"} className="uppercase tracking-wide">
                    {data.profile?.is_admin ? "Admin" : "User"}
                  </Badge>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-secondary/30">
                  <span className="text-sm font-medium">Email Confirmed</span>
                  <Badge variant={data.email_confirmed_at ? "outline" : "destructive"} className="bg-background">
                    {data.email_confirmed_at ? "Yes" : "No"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Activity Log */}
          <Card className="md:col-span-3 border-border/50 shadow-md mt-4">
            <CardHeader className="border-b border-border/50 bg-secondary/20">
              <CardTitle className="flex items-center gap-2">
                <History className="w-5 h-5 text-primary" />
                Credit Activity Log
              </CardTitle>
              <CardDescription>Recent transactions and usage history.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                    <TableHead className="pl-6">Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Feature</TableHead>
                    <TableHead className="text-right pr-6">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.transactions?.length > 0 ? (
                    data.transactions.map((tx: any) => (
                      <TableRow key={tx.id} className="hover:bg-secondary/30">
                        <TableCell className="pl-6 font-mono text-sm">
                          {new Date(tx.created_at).toLocaleDateString()} <span className="text-muted-foreground">{new Date(tx.created_at).toLocaleTimeString()}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize font-normal">
                            {tx.transaction_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="capitalize text-muted-foreground">{tx.feature_type || "-"}</TableCell>
                        <TableCell className={`text-right pr-6 font-mono font-bold ${tx.amount > 0 ? "text-green-500" : "text-red-500"}`}>
                          {tx.amount > 0 ? "+" : ""}{tx.amount}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
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
