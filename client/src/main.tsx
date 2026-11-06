import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./issue-ux.css";
import "./integration-r5.css";
import { captureShareHash } from "./lib/import-arrival";

// "Send to phone" links (#/import?…) are caught before the router sees them, on a cold start and while the app is
// open (this listener runs before wouter's): the Planner then shows the import preview.
captureShareHash();
window.addEventListener("hashchange", () => { captureShareHash(); });

if (!window.location.hash) {
  window.location.hash = "#/";
}

// Force dark mode for astronomy app
document.documentElement.classList.add('dark');

createRoot(document.getElementById("root")!).render(<App />);
