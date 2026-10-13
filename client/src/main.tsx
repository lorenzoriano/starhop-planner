import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (!window.location.hash) {
  window.location.hash = "#/";
}

// Force dark mode for astronomy app
document.documentElement.classList.add('dark');

createRoot(document.getElementById("root")!).render(<App />);
