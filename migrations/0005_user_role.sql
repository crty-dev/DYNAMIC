-- DYNAMIC v5 — super admin rolleri.
--
-- Better Auth'in `user` tablosuna bir rol alani ekleniyor. Varsayilan deger
-- "user" (kayit olan herkes). Super admin paneli (/dashboard) yalnizca
-- role = "admin" olan oturumlara aciktir; rol, Better Auth tarafindaki
-- `input: false` sayesinde kayit sirasinda istemci tarafindan verilemez.
--
-- Ilk admin nasil atanir:
--   1) Worker secret: ADMIN_EMAILS="info@crty-dev.com" (oturum acilinda
--      otomatik terfi),
--   2) ya da dogrudan D1: UPDATE user SET role = 'admin' WHERE email = ?;

ALTER TABLE user ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS idx_user_role ON user (role);
