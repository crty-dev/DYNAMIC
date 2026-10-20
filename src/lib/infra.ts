/**
 * Better Auth infrastructure (Dash + Sentinel) endpoints.
 *
 * `BETTER_AUTH_KV_URL` is the project scoped identify/KV URL that the Better
 * Auth dashboard hands out. The default (https://kv.better-auth.com) is a
 * global bucket shared by every project on the platform - Sentinel logs a
 * warning when it is used.
 *
 * The value is not a secret: the browser has to send it as well. The API key
 * stays in the Worker secret store.
 */
export const BETTER_AUTH_KV_URL =
  "https://kv.better-auth.com/projects/uPI3iXap8twuE6nKKp8Y51xMFzODBRqE";
