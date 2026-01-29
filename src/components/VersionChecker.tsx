import { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RefreshCw } from 'lucide-react';

interface VersionData {
  version: string;
  timestamp: number;
}

export function VersionChecker() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [remoteVersion, setRemoteVersion] = useState<string>('');

  useEffect(() => {
    // Check for updates every 60 seconds
    const interval = setInterval(checkForUpdate, 60 * 1000);
    
    // Also check when window gains focus
    window.addEventListener('focus', checkForUpdate);
    
    // Initial check
    checkForUpdate();

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', checkForUpdate);
    };
  }, []);

  const checkForUpdate = async () => {
    try {
      // Add timestamp to bypass browser cache
      const res = await fetch(`/version.json?t=${Date.now()}`);
      if (!res.ok) return;
      
      const data: VersionData = await res.json();
      const currentVersion = 'v5.3.0'; // Hardcoded to match package.json of this build
      
      // If we are running an older version than what's on the server
      if (data.version !== `v${currentVersion}` && data.version > `v${currentVersion}`) {
         // Note: String comparison isn't perfect for semantic versioning but works for v5.3 vs v5.4
         // Ideally we check timestamps if versions are same but rebuilds happened
      }
      
      // Simple timestamp check: If server timestamp is significantly newer (> 5 mins) than our build time
      // But we don't have our own build time easily accessible at runtime unless we inject it.
      // So let's rely on the hardcoded version string.
      
      // Actually, let's just compare the version string from the file vs the one we know we are.
      // Ideally, we inject __APP_VERSION__ via vite define.
      
      // For now, let's use the mismatch logic.
      // If the fetched version is DIFFERENT from what we expect this build to be.
      // But wait, if I build v5.3 now, the server has v5.3.
      // If I later build v5.4, the server has v5.4, but the client (v5.3) sees v5.4.
      
      // Since we can't easily inject the version into this component without vite config changes,
      // let's assume we want to reload if the version string in version.json changes from what we loaded initially.
      
    } catch (e) {
      console.error("Failed to check version", e);
    }
  };

  // Improved Logic: Store the initial version we saw when we first loaded.
  // If the server version ever differs from that, we need a reload.
  useEffect(() => {
    const checkInitial = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          sessionStorage.setItem('app_version', data.version);
        }
      } catch (e) { console.error(e); }
    };
    checkInitial();
  }, []);

  const periodicCheck = async () => {
    try {
      const currentStoredVersion = sessionStorage.getItem('app_version');
      if (!currentStoredVersion) return; // Haven't established baseline yet

      const res = await fetch(`/version.json?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.version !== currentStoredVersion) {
          console.log(`Version mismatch! Current: ${currentStoredVersion}, Remote: ${data.version}`);
          setRemoteVersion(data.version);
          setHasUpdate(true);
          
          // Optional: Auto-reload if user is idle? 
          // For now, just show the toast/button.
          toast("New update available!", {
            description: "A new version of the app is available.",
            action: {
              label: "Refresh",
              onClick: () => window.location.reload(),
            },
            duration: Infinity, // Stay until clicked
          });
        }
      }
    } catch (e) { console.error(e); }
  };

  // Run periodic check
  useEffect(() => {
    const interval = setInterval(periodicCheck, 30 * 1000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  if (!hasUpdate) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-5">
      <Button 
        onClick={() => window.location.reload()} 
        className="shadow-lg bg-green-600 hover:bg-green-700 text-white gap-2"
      >
        <RefreshCw className="w-4 h-4 animate-spin" />
        Update Available ({remoteVersion})
      </Button>
    </div>
  );
}
