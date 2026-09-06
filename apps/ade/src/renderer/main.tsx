/**
 * The renderer's entry point.
 *
 * No Node, no `require`, no filesystem: this is a browser, and everything it
 * knows comes from the local service over HTTP or from the four functions the
 * preload bridge exposes (LLD §13.6).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
/*
 * The design system first, then the shell's layout, then the eleven legacy
 * screens' stylesheet — which Phase 10 deletes with them (T10.3).
 */
import "@svatah/ui-tokens/tokens.css";
import "@svatah/ui/ui.css";
import "./shell/shell.css";
import "./app.css";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
