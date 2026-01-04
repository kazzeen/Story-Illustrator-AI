import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Sparkles, CreditCard, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface ZeroCreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userTier?: "free" | "starter" | "creator" | "professional";
}

export function ZeroCreditsDialog({
  open,
  onOpenChange,
  userTier = "free",
}: ZeroCreditsDialogProps) {
  const navigate = useNavigate();
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (open) {
      setIsAnimating(true);
      // Track analytics event
      console.log("[Analytics] Zero credits modal shown");
    }
  }, [open]);

  const handleAction = (action: "buy_credits" | "join_membership") => {
    console.log(`[Analytics] User selected: ${action}`);
    
    // Smooth transition before navigation
    setIsAnimating(false);
    setTimeout(() => {
      onOpenChange(false);
      if (action === "buy_credits") {
        navigate("/pricing?mode=credits");
      } else {
        navigate("/pricing?mode=subscription");
      }
    }, 200);
  };

  // Prevent closing by clicking outside or escape key (non-dismissible requirement)
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Only allow closing via buttons
      return;
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        className={cn(
          "sm:max-w-[425px] transition-all duration-300",
          isAnimating ? "scale-100 opacity-100" : "scale-95 opacity-0"
        )}
        // Prevent closing via escape key
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
          <DialogTitle className="text-2xl font-display">Out of Credits</DialogTitle>
          <DialogDescription className="text-base pt-2">
            You've used all your credits for this cycle. Top up now to keep creating amazing stories!
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <Button
            size="lg"
            variant="default"
            className="w-full gap-2 relative overflow-hidden group"
            onClick={() => handleAction("buy_credits")}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-white/20 to-primary/0 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000" />
            <CreditCard className="w-4 h-4" />
            Buy More Credits
          </Button>

          <Button
            size="lg"
            variant="outline"
            className="w-full gap-2 border-primary/20 hover:bg-primary/5"
            onClick={() => handleAction("join_membership")}
          >
            <Sparkles className="w-4 h-4 text-primary" />
            {userTier === "free" ? "Upgrade Membership" : "Manage Membership"}
          </Button>
        </div>

        <DialogFooter className="sm:justify-center">
          <p className="text-xs text-muted-foreground text-center w-full">
            Need help? <a href="mailto:support@siai.com" className="underline hover:text-foreground">Contact Support</a>
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
