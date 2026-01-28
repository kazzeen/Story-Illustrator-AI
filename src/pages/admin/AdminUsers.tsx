import { useEffect, useState } from "react";
import { adminApi } from "@/hooks/admin-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/layout/Navbar";

export default function AdminUsers() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await adminApi<{ users: any[] }>("users");
      setUsers(data.users || []);
    } catch (err: any) {
      console.error("Failed to load users", err);
      setError(err.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-6 pt-24 pb-12">
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="bg-destructive/15 text-destructive p-4 rounded-md mb-4">
                {error}
              </div>
            )}
            {loading ? (
              <div>Loading...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Created At</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{new Date(user.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {user.profile?.subscription_tier || "free"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {user.profile?.is_admin ? (
                          <Badge variant="default">Admin</Badge>
                        ) : (
                          <span className="text-muted-foreground">User</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
