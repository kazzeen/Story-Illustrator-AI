import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      const isSupabaseConfigured = 
        import.meta.env.VITE_SUPABASE_URL && 
        import.meta.env.VITE_SUPABASE_URL.length > 0;
      
      const isAnonKeyConfigured = 
        import.meta.env.VITE_SUPABASE_ANON_KEY && 
        import.meta.env.VITE_SUPABASE_ANON_KEY.length > 0;

      return (
        <div className="p-4 m-4 border border-red-500 rounded bg-red-50 text-red-900">
          <h1 className="text-xl font-bold mb-2">Something went wrong (v5.1-SYNC)</h1>
          <div className="mb-4 p-2 bg-white rounded border border-red-200 text-sm">
             <strong>Environment Diagnostics:</strong>
             <ul className="list-disc pl-5 mt-1">
               <li>Supabase URL: {isSupabaseConfigured ? "✅ Configured" : "❌ MISSING"}</li>
               <li>Anon Key: {isAnonKeyConfigured ? "✅ Configured" : "❌ MISSING"}</li>
               <li>Build Time: {new Date().toISOString()}</li>
             </ul>
          </div>
          <pre className="text-sm overflow-auto max-w-full">
            {this.state.error?.toString()}
          </pre>
          <pre className="text-xs mt-2 text-gray-600">
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
