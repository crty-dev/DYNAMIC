# DYNAMIC — Görev Listesi / Yol Haritası

Oşe olunar) öncelikli, mevcut boş workspace gerçeklerine göre.

## Faz 0 — Temel kurulum (bu oturumda başlar)

- [x] Git deposunu kur, mevcut varlıkları (images/, LICENSE, README, docs) güvenli ilk commitle
- [x] `.gitignore` (secrets sırızılama gapı kayıtları)
- [x] `LICENSE` (MIT)
- [x] `README.md` + `docs/ARCHITECTURE.md` + `docs/ROADMAP.md`
- [ ] **Kullanıcı kararı:** anlamda kaynak kod başka yerde mi, yoksa bu workspace'te sıfırdan mı kurulacak?

## Faz 1 — Proje iskeleti (karardan sonra)

- [ ] `package.json` (Vite + TS, tek paket; workspaces GEREKMEZ)
- [ ] Vite + React + TypeScript kurulumu (React, ReactDOM, TS konfigürasyonları)
- [ ] Tailwind CSS v4 + shadcn/ui jagged kurulumu (PALET: `#1d72fc→#24d2cd`)
- [ ] `wrangler.jsonc` (Worker main + Static Assets `dist/`, D1 binding `DB`)
- [ ] `worker/` (Hono) — `health`, `collect` (stub), `auth` route iskeleti ve middleware
- [ ] React Router + TanStack Query sağğuçu (Provider kurulum) 
- [ ] Local dev: `vite build` + `wrangler dev` (Statik assets ile)

## Faz 2 — Veri katmanı

- [ ] D1 migration 0001: `sites`, `events`, `session_cache` + indexler
- [ ] `collect` endpoint: origin/CORS doğrulaması, payload şema (zod), batch insert `db.batch()`
- [ ] `admin/auth` (v1: token-based; session cookies bir sonraki adım)
- [ ] Dashboard sorguları: günlük/haftalık özet sunmak için **satır okuma ekonomisi** stratejisi (index'li sorgular, zaman birliştirmesi)

## Faz 3 — SDK + RUM

- [ ] `web-vitals` attribution build entegrasyonu, `sendBeacon` batiş
- [ ] `public/js/dctv.js` — siteleyici embed script (data `siteKey` attr, async/dedupted)
- [ ] Session heuristik (no cookie: IP-hash yerine Günlük rotasyonlu hash + UA)
- [ ] Dedup: `metric_id` (web-vitals "id") o aplicaciones; eğer aynı id tekrar gelen delta'lar

## Faz 4 — Landing + Dashboard UI

- [ ] Landing: Figma referans kompozisyonu → marka paleti mavi-turkuaz; `images/` WebP varlıkları (lazy)
- [ ] shadcn bileşenleri: card, table, tabs, dialog, tooltip
- [ ] Dashboard v1: Traffic özeti, siteler listesi, event grafiği (Recharts), ülke/cihaz filtreleri
- [ ] RUM sekmesi: CWV skor kartı (LCP/INP/CLS/FCP/TTFB), p75 trendleri, páginas detalle

## Faz 5 — Dağıtım (Free plan)

- [ ] `npx wrangler d1 create dynamic` → projeye bağla
- [ ] `npx wrangler d1 migrations apply dynamic --remote`
- [ ] `npx wrangler deploy` → bağlama custom domain (`dynamic.crty-dev.com` DNS'te geldiğinde)
- [ ] Cloudflare Observability: error-free `wrangler tail` doğrulaması
- [ ] Free plan kota gözlemi: Workers istek/d, D1 row read/gügün — Monitoring noktası

## Faz 6 — (v2, opsiyonel)

- [ ] R2 90 gün+ topic snapshot export (Class B maliyeti monitor edilerek)
- [ ] Cron: 14 günlük sass políticas (D1 doğrulaması sfür)
- [ ] Waterfall + dokunmatik Heat-masan? gerekirse
- [ ] TestData: Vitest + testsprite betikleri
