import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import ErrorBoundary from "./components/ErrorBoundary";

// Log build time to help debug stale deployment issues
console.log(`%c Build Time: ${__BUILD_TIME__}`, 'color: #00ff00; background: #000; font-size: 12px; padding: 4px;');
console.log(`%c APP INITIALIZING v5.2-FORCE`, 'color: #ff00ff; background: #000; font-size: 14px; padding: 4px; font-weight: bold;');

// Diagnostics for Environment Variables (Safe Logging)
const sbUrl = import.meta.env.VITE_SUPABASE_URL;
const sbAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;
const sbPub = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

console.group('Environment Diagnostics');
console.log('VITE_SUPABASE_URL:', sbUrl ? 'Set' : 'MISSING');
console.log('VITE_SUPABASE_ANON_KEY:', sbAnon ? `Set (starts with ${sbAnon.slice(0, 5)}...)` : 'MISSING');
console.log('VITE_SUPABASE_PUBLISHABLE_KEY:', sbPub ? `Set (starts with ${sbPub.slice(0, 5)}...)` : 'MISSING');
console.groupEnd();

// Aggressively unregister any service workers to prevent stale caching
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for(let registration of registrations) {
      console.log('Unregistering service worker:', registration);
      registration.unregister();
    }
  });
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
