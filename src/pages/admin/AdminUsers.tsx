import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "@/hooks/admin-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Eye, RefreshCw, Users, Shield } from "lucide-react";
import { toast } from "sonner";

export default function AdminUsers() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminApi<{ users: any[] }>("users");
      setUsers(data.users || []);
    } catch (err: any) {
      console.error("Failed to load users", err);
      setError(err.message || "Failed to load users");
      toast.error("Failed to fetch user list");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-6 pt-24 pb-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-3">
              <Shield className="w-8 h-8 text-primary" />
              Admin Dashboard
            </h1>
            <p className="text-muted-foreground mt-2">
              Manage users, subscriptions, and system settings.
            </p>
          </div>
          <Button onClick={loadUsers} variant="outline" disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh List
          </Button>
        </div>

        <Card className="border-border/50 shadow-lg backdrop-blur-sm bg-card/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary" />
                  Registered Users
                </CardTitle>
                <CardDescription>
                  Total users: {users.length}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="bg-destructive/15 text-destructive p-4 rounded-xl mb-6 flex items-center gap-3 border border-destructive/20">
                <Shield className="w-5 h-5" />
                {error}
              </div>
            )}
            
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <RefreshCw className="w-8 h-8 animate-spin mb-4 text-primary" />
                <p>Loading user data...</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                      <TableHead>User</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id} className="group hover:bg-secondary/30 transition-colors">
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">{user.email}</span>
                            <span className="text-xs text-muted-foreground font-mono">{user.id.slice(0, 8)}...</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col text-sm">
                            <span>{new Date(user.created_at).toLocaleDateString()}</span>
                            <span className="text-xs text-muted-foreground">{new Date(user.created_at).toLocaleTimeString()}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {user.profile?.subscription_tier || "free"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {user.profile?.is_admin ? (
                            <Badge variant="default" className="bg-primary hover:bg-primary/90">Admin</Badge>
                          ) : (
                            <Badge variant="secondary">User</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => navigate(`/admin/users/${user.id}`)}
                          >
                            <Eye className="w-4 h-4 mr-2" />
                            Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {users.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No users found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
