import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import "./app.css";
import "../styles/fonts.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root bulunamadı");

/**
 * The console is served under /app when it shares the marketing origin and
 * at the root of its own host. Without the basename the router would not
 * match any route below /app and would fall back to the marketing page.
 */
const basename = /^\/app(\/|$)/.test(window.location.pathname) ? "/app" : "";

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
