import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export default function Debug() {
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [dbError, setDbError] = useState<string | null>(null);
  const [profileCount, setProfileCount] = useState<number | null>(null);

  const envVars = {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    MODE: import.meta.env.MODE,
    PROD: import.meta.env.PROD,
    DEV: import.meta.env.DEV,
  };

  const checkConnection = async () => {
    setDbStatus('checking');
    setDbError(null);
    try {
      const { count, error } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
      if (error) throw error;
      setProfileCount(count);
      setDbStatus('connected');
    } catch (e: any) {
      console.error(e);
      setDbStatus('error');
      setDbError(e.message || JSON.stringify(e));
    }
  };

  useEffect(() => {
    checkConnection();
  }, []);

  const getMasked = (val: string | undefined) => {
    if (!val) return 'MISSING';
    if (val.length < 10) return val;
    return `${val.substring(0, 6)}...${val.substring(val.length - 4)}`;
  };

  return (
    <div className="container mx-auto p-8 space-y-8">
      <h1 className="text-3xl font-bold font-display">Deployment Diagnostics</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Build Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center border-b pb-2">
              <span className="font-semibold text-muted-foreground">App Version</span>
              <span className="font-mono text-lg">v5.4-DEBUG</span>
            </div>
            <div className="flex justify-between items-center border-b pb-2">
              <span className="font-semibold text-muted-foreground">Commit Hash</span>
              <Badge variant="outline" className="font-mono text-base">{__COMMIT_HASH__}</Badge>
            </div>
            <div className="flex justify-between items-center border-b pb-2">
              <span className="font-semibold text-muted-foreground">Build Time</span>
              <span className="font-mono text-sm">{__BUILD_TIME__}</span>
            </div>
            <div className="flex justify-between items-center border-b pb-2">
              <span className="font-semibold text-muted-foreground">Environment</span>
              <Badge>{envVars.MODE}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Database Connection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className={`w-4 h-4 rounded-full ${
                dbStatus === 'connected' ? 'bg-green-500 animate-pulse' : 
                dbStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500'
              }`} />
              <span className="font-medium uppercase">{dbStatus}</span>
              <Button size="sm" variant="outline" onClick={checkConnection}>Retry</Button>
            </div>
            
            {dbStatus === 'connected' && (
              <div className="p-4 bg-green-500/10 rounded-lg text-green-700 dark:text-green-300">
                Success! Connected to Supabase.<br/>
                Found {profileCount} profiles.
              </div>
            )}

            {dbStatus === 'error' && (
              <div className="p-4 bg-red-500/10 rounded-lg text-red-700 dark:text-red-300 break-all">
                Error: {dbError}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Environment Variables (Runtime)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 font-mono text-sm">
              {Object.entries(envVars).map(([key, value]) => (
                <div key={key} className="flex flex-col sm:flex-row justify-between border-b py-2">
                  <span className="text-muted-foreground">{key}</span>
                  <span className={!value ? "text-red-500 font-bold" : ""}>
                    {typeof value === 'boolean' ? String(value) : getMasked(value)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
