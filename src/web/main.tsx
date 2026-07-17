import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/400-italic.css";
import "@fontsource/lora/500.css";
import "@fontsource/jetbrains-mono/400.css";
import "./styles.css";

import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { StoreProvider } from "./store.js";

const saved = localStorage.getItem("beni-theme");
if (saved === "light") document.documentElement.dataset.theme = "light";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>
);
