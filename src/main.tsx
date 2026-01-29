import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import ErrorBoundary from "./components/ErrorBoundary";

// Log build time to help debug stale deployment issues
console.log(`%c Build Time: ${__BUILD_TIME__}`, 'color: #00ff00; background: #000; font-size: 12px; padding: 4px;');
console.log(`%c APP INITIALIZING v2.5`, 'color: #00ffff; background: #000; font-size: 14px; padding: 4px; font-weight: bold;');

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
