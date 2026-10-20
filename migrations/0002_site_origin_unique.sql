-- DYNAMIC v1 — one site per origin
-- The collect endpoint is self-serve: the first event from a new origin
-- creates its site. A unique origin also makes concurrent first writes safe
-- (INSERT OR IGNORE + select).

CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_origin ON sites (origin);
