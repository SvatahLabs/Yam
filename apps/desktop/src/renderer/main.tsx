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
 * The design system, then this application's layout. There is no third
 * stylesheet: T10.3 deleted `app.css` with the eleven screens it dressed.
 */
import "@svatah/yam-ui-tokens/tokens.css";
import "@svatah/yam-ui/ui.css";
import "./shell/shell.css";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
