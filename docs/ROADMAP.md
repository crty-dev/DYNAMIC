# DYNAMIC — Görev Listesi / Yol Haritası

Oşe olunar) öncelikli, mevcut boş workspace gerçeklerine göre.

## Faz 0 — Temel kurulum (bu oturumda başlar)

- [x] Git deposunu kur, mevcut varlıkları (images/, LICENSE, README, docs) güvenli ilk commitle
- [x] `.gitignore` (secrets sırızılama gapı kayıtları)
- [x] `LICENSE` (MIT)
- [x] `README.md` + `docs/ARCHITECTURE.md` + `docs/ROADMAP.md`
- [ ] **Kullanıcı kararı:** anlamda kaynak kod başka yerde mi, yoksa bu workspace'te sıfırdan mı kurulacak?

## Faz 1 — Proje iskeleti (karardan sonra)

- [x] `package.json` (Vite + TS, tek paket; workspaces GEREKMEZ)
- [x] Vite + React + TypeScript kurulumu (React, ReactDOM, TS konfigürasyonları)
- [x] Tailwind CSS v4 + shadcn/ui jagged kurulumu (PALET: `#1d70fd→#23d8ca`)
- [x] `wrangler.jsonc` (Worker main + Static Assets `dist/`, D1 binding `DB`)
- [x] `worker/` (Hono) — `health`, `collect` (stub), `auth` route iskeleti ve middleware
- [x] React Router + TanStack Query sağğuçu (Provider kurulum) 
- [x] Local dev: `vite build` + `wrangler dev` (Statik assets ile)

## Faz 2 — Veri katmanı

- [x] D1 migration 0001: `sites`, `events`, `session_cache` + indexler
- [x] `collect` endpoint: origin/CORS doğrulaması, payload şema (zod), batch insert `db.batch()`
- [x] Migration 0003: `sessions`, `goals`, event kırılım boyutları, dedup indeksi, saklama + kota ayarları
- [x] Dashboard sorguları: `/api/analytics/*` ve `/api/rum/*` — index'li, site + zaman aralığı sınırlı
- [x] Admin/auth: `/api/admin/*` bearer token koruması, site/goal yönetimi, retention purge
- [ ] Admin/auth v2: session cookie + çok kullanıcılı roller

## Faz 3 — SDK + RUM

- [x] `public/js/dynamic.js` — async SDK: otomatik sayfa görüntüleme, özel event, SPA navigasyon, batch, boyut sınırı, sınırlı retry
- [x] Consent / opt-out: DNT izni, `consent.grant/deny`, `optIn/optOut`
- [x] Kişisel veri yok: prop filtreleme, form/input okunmaz, çerez yok (sessionStorage + 30 dk rotasyon)
- [x] `web-vitals` paketlenmiş: LCP/INP/CLS/FCP/TTFB, metric id ile dedup
- [x] RUM raporları: p50/p75/ortalama + rating dağılımı; yetersiz veride p75 boş kalır
- [x] Free plan koruması: günlük kota, retention cron, sessions tablosu, satır okuma ekonomisi

## Faz 4 — Landing + Dashboard UI

- [x] Landing: Figma referans kompozisyonu → marka paleti mavi-turkuaz; `images/` WebP varlıkları (lazy)
- [ ] shadcn bileşenleri: card, table, tabs, dialog, tooltip
- [x] Dashboard v1: `src/console/` — Traffic özeti, event grafiği (Recharts), ülke/cihaz/referrer/dönüşüm kırılımları
- [x] RUM sekmesi: CWV skor kartı (LCP/INP/CLS/FCP/TTFB), p75, en yavaş sayfalar
- [x] Flatlogic "react-dashboard" şablonu konsol düzenine taşındı (eski CRA/Express çalıştırması taşınmadı)
- [x] SDK snippet landing'e bağlandı (uçtan uca akış: SDK → ingest → D1 → konsol)

## Faz 5 — Dağıtım (Free plan)

- [x] `npx wrangler d1 create dynamic` → projeye bağla
- [x] `npx wrangler d1 migrations apply dynamic --remote`
- [x] `npx wrangler deploy` → `dynamic.streamforge-46.workers.dev` yayında
- [x] Custom domain: `dynamic.crty-dev.com` Worker'a bağlandı ve HTTPS üzerinden yayında
- [x] Cloudflare Observability: `observability.enabled` wrangler.jsonc'de açık
- [ ] Free plan kota gözlemi: Workers istek/g, D1 row read/gün — Monitoring noktası

## Faz 6 — (v2, opsiyonel)

- [ ] R2 90 gün+ topic snapshot export (Class B maliyeti monitor edilerek)
- [ ] Cron: 14 günlük sass políticas (D1 doğrulaması sfür)
- [ ] Waterfall + dokunmatik Heat-masan? gerekirse
- [ ] TestData: Vitest + testsprite betikleri
