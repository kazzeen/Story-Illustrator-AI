import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/auth-provider";
import { AdminProvider } from "@/hooks/admin-provider";
import { ThemeProvider } from "next-themes";
import Index from "./pages/Index";
import Import from "./pages/Import";
import Storyboard from "./pages/Storyboard";
import Auth from "./pages/Auth";
import Pricing from "./pages/Pricing";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminBypass from "./pages/admin/AdminBypass";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminUserDetails from "./pages/admin/AdminUserDetails";
import AdminAuditLogs from "./pages/admin/AdminAuditLogs";
import { RequireAdmin } from "@/components/routing/RequireAdmin";

const queryClient = new QueryClient();
const adminEnabled = String(import.meta.env.VITE_ADMIN_UI_ENABLED ?? "true").toLowerCase() !== "false";

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <AdminProvider>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/import" element={<Import />} />
                <Route path="/storyboard" element={<Storyboard />} />
                <Route path="/storyboard/:storyId" element={<Storyboard />} />

                {adminEnabled && (
                  <>
                    <Route path="/admin/login" element={<AdminLogin />} />
                    <Route path="/admin/bypass" element={<AdminBypass />} />
                    <Route
                      path="/admin"
                      element={
                        <RequireAdmin>
                          <AdminDashboard />
                        </RequireAdmin>
                      }
                    />
                    <Route
                      path="/admin/users"
                      element={
                        <RequireAdmin>
                          <AdminUsers />
                        </RequireAdmin>
                      }
                    />
                    <Route
                      path="/admin/users/:id"
                      element={
                        <RequireAdmin>
                          <AdminUserDetails />
                        </RequireAdmin>
                      }
                    />
                    <Route
                      path="/admin/audit-logs"
                      element={
                        <RequireAdmin>
                          <AdminAuditLogs />
                        </RequireAdmin>
                      }
                    />
                  </>
                )}

                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </ThemeProvider>
      </AdminProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
