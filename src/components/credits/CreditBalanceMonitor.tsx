import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ZeroCreditsDialog } from "./ZeroCreditsDialog";

export function CreditBalanceMonitor() {
  const { profile, user } = useAuth();
  const [showZeroCredits, setShowZeroCredits] = useState(false);
  
  // Track previous balance to detect transitions to zero
  const prevBalanceRef = useRef<number | null>(null);
  
  // Track if we've already shown the modal in this session to avoid annoyance
  // (Optional: requirement says "popup appears immediately when balance hits zero")
  // We'll stick to strict requirement: whenever it *hits* zero.
  // But we need to handle the case where it *starts* at zero (e.g. page refresh).
  // The requirement "continuously check... popup appears immediately when balance hits zero"
  // implies a transition. If I load the page with 0, did it "hit" zero just now?
  // Let's assume we show it if it drops to zero, OR if the user is active and has 0.
  // But showing it immediately on login might be intrusive if they are just browsing.
  // Let's rely on the transition for now.

  useEffect(() => {
    if (!profile || !user) return;

    const currentBalance = profile.credits_balance;
    const prevBalance = prevBalanceRef.current;

    // Check if balance dropped to zero
    if (
      typeof currentBalance === "number" &&
      currentBalance === 0 &&
      prevBalance !== null &&
      prevBalance > 0
    ) {
      console.log("[CreditMonitor] Balance dropped to zero");
      setShowZeroCredits(true);
    }

    // Update ref
    prevBalanceRef.current = currentBalance;
  }, [profile?.credits_balance, user]);

  if (!user || !profile) return null;

  return (
    <ZeroCreditsDialog
      open={showZeroCredits}
      onOpenChange={setShowZeroCredits}
      userTier={profile.subscription_tier as "free" | "starter" | "creator" | "professional"}
    />
  );
}
