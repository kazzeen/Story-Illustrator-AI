import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import ErrorBoundary from "./components/ErrorBoundary";

// Log build time to help debug stale deployment issues
console.log(`%c Build Time: ${__BUILD_TIME__}`, 'color: #00ff00; background: #000; font-size: 12px; padding: 4px;');

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
