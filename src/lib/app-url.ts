/**
 * The product application lives on its own origin:
 *   marketing  https://dynamic.crty-dev.com
 *   product    https://app.dynamic.crty-dev.com
 *
 * Local development overrides it with VITE_APP_URL (http://localhost:5174).
 */
export const APP_URL = (
  import.meta.env?.VITE_APP_URL && import.meta.env.VITE_APP_URL !== ""
    ? import.meta.env.VITE_APP_URL
    : "https://app.dynamic.crty-dev.com"
).replace(/\/+$/, "");
