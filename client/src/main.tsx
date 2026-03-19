import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (!window.location.hash) {
  window.location.hash = "#/";
}

// Force dark mode for astronomy app
document.documentElement.classList.add('dark');

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(
      (registration) => {
        console.log('[SW] Registered:', registration.scope);
        // Check for updates periodically (every 30 min)
        setInterval(() => registration.update(), 30 * 60 * 1000);
      },
      (error) => {
        console.log('[SW] Registration failed:', error);
      }
    );
  });
}
