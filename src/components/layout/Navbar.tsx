import { Link, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, Home, Upload, Grid3X3, LogIn, LogOut, Sparkles, User, CreditCard, Shield, PenTool } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navItems = [
  { path: "/", icon: Home, label: "Dashboard" },
  { path: "/create-story", icon: PenTool, label: "Create" },
  { path: "/import", icon: Upload, label: "Import" },
  { path: "/storyboard", icon: Grid3X3, label: "Storyboard" },
  { path: "/pricing", icon: CreditCard, label: "Pricing" },
];

function formatPlanLabel(tier: unknown) {
  const t = typeof tier === "string" ? tier.trim().toLowerCase() : "";
  if (t === "starter") return "Starter";
  if (t === "creator") return "Creator";
  if (t === "professional") return "Pro";
  if (t === "basic") return "Free";
  if (!t) return "Free";
  return t.slice(0, 1).toUpperCase() + t.slice(1);
}

export function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut, profile } = useAuth();
  const planLabel = formatPlanLabel(profile?.subscription_tier);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Error during sign out:", error);
    } finally {
      navigate('/auth');
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-border/50">
      <div className="container mx-auto px-6">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 group">
            <div className="relative">
              <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-glow group-hover:shadow-[0_0_30px_hsl(38_92%_50%_/_0.4)] transition-all duration-300">
                <BookOpen className="w-5 h-5 text-primary-foreground" />
              </div>
              <Sparkles className="w-3 h-3 text-primary absolute -top-1 -right-1 animate-pulse" />
            </div>
            <span className="font-display text-xl font-semibold text-foreground flex items-center gap-2">
              SIAI {profile?.is_admin && <span className="ml-2 text-xs bg-red-600 text-white px-2 py-0.5 rounded-full font-medium border border-red-800 animate-pulse">v6.0-RESET</span>}
            </span>
          </Link>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link key={item.path} to={item.path}>
                  <Button
                    variant="ghost"
                    className={cn(
                      "gap-2 px-4",
                      isActive && "bg-secondary text-primary"
                    )}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </Button>
                </Link>
              );
            })}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {user ? (
              <>
                {profile && (
                  <Link to="/pricing">
                    <Button variant="ghost" size="sm" className="hidden sm:flex items-center gap-2">
                      <CreditCard className="w-4 h-4" />
                      <span className="font-semibold">{profile.credits_balance ?? 0}</span>
                      <span className="text-muted-foreground text-xs">credits </span>
                      <span className="text-muted-foreground text-xs">{planLabel}</span>
                    </Button>
                  </Link>
                )}
                <Link to="/import">
                  <Button variant="hero" size="sm">
                    New Story
                  </Button>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative">
                      <User className="w-5 h-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem className="text-muted-foreground text-sm" disabled>
                      {user.email}
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/profile">
                        <User className="w-4 h-4 mr-2" />
                        Profile
                      </Link>
                    </DropdownMenuItem>
                    {profile?.is_admin && (
                      <DropdownMenuItem asChild>
                        <Link to="/admin/users">
                          <Shield className="w-4 h-4 mr-2" />
                          Admin Panel
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleSignOut}>
                      <LogOut className="w-4 h-4 mr-2" />
                      Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <Link to="/auth">
                <Button variant="hero" size="sm" className="gap-2">
                  <LogIn className="w-4 h-4" />
                  Sign In
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
