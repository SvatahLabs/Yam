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
import "./app.css";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
