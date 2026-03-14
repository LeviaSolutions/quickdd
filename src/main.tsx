import React from "react";
import ReactDOM from "react-dom/client";

// Initialize i18n before rendering
import "@/i18n";

// Global styles (Tailwind + custom)
import "@/styles/globals.css";

import { App } from "@/App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
